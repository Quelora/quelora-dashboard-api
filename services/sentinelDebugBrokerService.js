/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: sentinelDebugBrokerService.js */
'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

/**
 * Registry of active debug sessions bridging a Sentinel (Client) and an AI Agent (Backend).
 * @typedef {Object} DebugSession
 * @property {string} pin - The unique 6-character hexadecimal session identifier.
 * @property {import('ws')|null} sentinel - The browser client WebSocket connection.
 * @property {import('ws')|null} agent - The AI Agent/Terminal WebSocket connection.
 */

/** @type {Map<string, DebugSession>} */
const activeSessions = new Map();

/** @returns {string} A 6-character hexadecimal string (e.g., 'A1B2C3'). */
const generateSessionPin = () => crypto.randomBytes(3).toString('hex').toUpperCase();

/**
 * @param {string} secret
 * @returns {boolean}
 */
const verifyAgentSecret = (secret) => {
    const expectedSecret = process.env.INTERNAL_AI_SECRET;
    if (!expectedSecret) {
        console.warn('[Sentinel Broker] WARNING: INTERNAL_AI_SECRET is not set.');
        return false;
    }
    return secret === expectedSecret;
};

/**
 * Initializes the Sentinel Debug Broker WebSocket Server.
 *
 * Accepts either a raw http.Server instance or an Express app.
 * If an Express app is passed, a new http.Server is created internally and returned.
 *
 * @param {import('http').Server|import('express').Application} serverOrApp
 * @returns {{ wss: WebSocketServer, server: import('http').Server }}
 *
 * @example
 * // app.js — using an existing HTTP server
 * const { createServer } = require('http');
 * const { initializeSentinelBrokerServer } = require('./sentinelBroker');
 * const app = require('express')();
 * const server = createServer(app);
 * initializeSentinelBrokerServer(server);
 * server.listen(3000);
 *
 * @example
 * // app.js — passing the Express app directly
 * const { initializeSentinelBrokerServer } = require('./sentinelBroker');
 * const app = require('express')();
 * const { server } = initializeSentinelBrokerServer(app);
 * server.listen(3000);
 */
const initializeSentinelBrokerServer = (serverOrApp) => {
    // Accept either an http.Server or an Express app
    const isHttpServer = serverOrApp instanceof http.Server;
    const server = isHttpServer ? serverOrApp : http.createServer(serverOrApp);

    const wss = new WebSocketServer({
        server,
        path: '/ws/debug-broker',
        maxPayload: 10 * 1024 * 1024, // 10 MB — enough for heap snapshots / large DOM trees
    });

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Cleans up session references when either party disconnects
     * and notifies the remaining peer.
     * @param {import('ws')} ws
     */
    const handleDisconnection = (ws) => {
        if (!ws.sessionPin || !ws.role) return;

        const session = activeSessions.get(ws.sessionPin);
        if (!session) return;

        const notify = (target, message) => {
            if (target && target.readyState === target.OPEN) {
                target.send(JSON.stringify({ action: 'SYSTEM_EVENT', message }));
            }
        };

        if (ws.role === 'SENTINEL') {
            session.sentinel = null;
            notify(session.agent, 'Target Sentinel disconnected from the session.');
        } else if (ws.role === 'AGENT') {
            session.agent = null;
            notify(session.sentinel, 'AI Agent detached from the session.');
        }

        if (!session.sentinel && !session.agent) {
            activeSessions.delete(ws.sessionPin);
            console.log(`[Sentinel Broker] Session ${ws.sessionPin} destroyed.`);
        }
    };

    const sendJSON = (ws, payload) => ws.send(JSON.stringify(payload));

    // ─── Connection handling ──────────────────────────────────────────────────

    wss.on('connection', (ws) => {
        ws.isAlive   = true;
        ws.sessionPin = null;
        ws.role       = null;

        ws.on('pong', () => { ws.isAlive = true; });

        ws.on('message', (messageBuffer, isBinary) => {
            try {
                // Try to parse JSON control frames; binary / non-JSON payloads stay as-is
                let data = null;
                try { data = JSON.parse(messageBuffer.toString()); } catch (_) { /* raw buffer */ }

                // ── Phase 1: Role assignment ──────────────────────────────────

                if (data?.action === 'INIT_SESSION' && data.role === 'SENTINEL') {
                    const pin = generateSessionPin();
                    ws.sessionPin = pin;
                    ws.role = 'SENTINEL';
                    activeSessions.set(pin, { pin, sentinel: ws, agent: null });
                    sendJSON(ws, { action: 'SESSION_CREATED', sessionPin: pin });
                    console.log(`[Sentinel Broker] Sentinel created session: ${pin}`);
                    return;
                }

                if (data?.action === 'JOIN_SESSION' && data.role === 'AGENT') {
                    if (!verifyAgentSecret(data.secret)) {
                        sendJSON(ws, { action: 'ERROR', message: 'Unauthorized Agent connection attempt.' });
                        return ws.terminate();
                    }

                    const session = activeSessions.get(data.sessionPin);
                    if (!session) {
                        sendJSON(ws, { action: 'ERROR', message: `Session PIN ${data.sessionPin} not found.` });
                        return ws.terminate();
                    }

                    // Evict stale agent — only one agent per session
                    if (session.agent && session.agent !== ws) {
                        sendJSON(session.agent, { action: 'ERROR', message: 'Evicted by a new Agent connection.' });
                        session.agent.terminate();
                    }

                    ws.sessionPin = data.sessionPin;
                    ws.role = 'AGENT';
                    session.agent = ws;

                    sendJSON(ws, { action: 'JOINED_SUCCESSFULLY', sessionPin: data.sessionPin });

                    // CORRECCIÓN: Comprobación explícita de existencia antes de verificar el estado
                    if (session.sentinel && session.sentinel.readyState === session.sentinel.OPEN) {
                        sendJSON(session.sentinel, { action: 'SYSTEM_EVENT', message: 'AI Agent attached and listening.' });
                    }
                    console.log(`[Sentinel Broker] Agent joined session: ${data.sessionPin}`);
                    return;
                }

                // ── Phase 2: Dumb-pipe routing ────────────────────────────────

                if (!ws.sessionPin || !ws.role) {
                    return sendJSON(ws, { action: 'ERROR', message: 'Not bound to any session. Send INIT_SESSION or JOIN_SESSION first.' });
                }

                const session = activeSessions.get(ws.sessionPin);
                if (!session) return;

                if (ws.role === 'SENTINEL') {
                    // CORRECCIÓN: Comprobación explícita de existencia del agente
                    if (session.agent && session.agent.readyState === session.agent.OPEN) {
                        session.agent.send(messageBuffer, { binary: isBinary });
                    }
                } else if (ws.role === 'AGENT') {
                    // CORRECCIÓN: Comprobación explícita de existencia del sentinel
                    if (session.sentinel && session.sentinel.readyState === session.sentinel.OPEN) {
                        session.sentinel.send(messageBuffer, { binary: isBinary });
                    } else {
                        sendJSON(ws, { action: 'ERROR', message: 'Target Sentinel is offline or unreachable.' });
                    }
                }

            } catch (error) {
                console.error(`[Sentinel Broker] Routing error on session ${ws.sessionPin}:`, error.message);
            }
        });

        ws.on('close', () => handleDisconnection(ws));
        ws.on('error', () => handleDisconnection(ws));
    });

    // ─── Zombie connection sweeper (every 30 s) ───────────────────────────────

    const healthInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (!ws.isAlive) {
                handleDisconnection(ws);
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, 30_000);

    wss.on('close', () => {
        clearInterval(healthInterval);
        activeSessions.clear();
        console.log('[Sentinel Broker] Server closed. All sessions cleared.');
    });

    return { wss, server };
};

module.exports = { initializeSentinelBrokerServer };