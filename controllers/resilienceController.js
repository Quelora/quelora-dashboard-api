/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./controllers/resilienceController.js
const crypto = require('crypto');
const Client = require('@quelora/common/models/Client');
const { validateCidAccess } = require('../utils/accessControl');

/**
 * Default resilience configuration returned when no document exists yet for a client.
 * Mirrors the shape expected by ResilienceConfigModal on the frontend.
 *
 * @type {Object}
 */
const DEFAULT_RESILIENCE = {
    enabled: false,
    algorithm: 'ed25519',
    keyId: '',
    publicKey: '',
    updatedAt: null,
    forceMode: false,
    mode: 'HYBRID',
    triggers: {
        maxEventLoopLag: 200,
        maxMemoryHeap: 85,
        maxConnections: 0,
    },
    weights: {
        trust: 0.4,
        activity: 0.4,
        geo: 0.2,
    },
};

/**
 * Allowed resilience operation modes.
 *
 * @type {string[]}
 */
const ALLOWED_MODES = ['HYBRID', 'P2P_ONLY', 'SERVER_ONLY', 'PASSIVE'];

/**
 * Validates the shape and business rules of the resilience payload sent by the client.
 * Key material fields (keyId, publicKey, updatedAt) are intentionally excluded from
 * validation here since they are managed server-side only.
 *
 * @param {Object} payload - The request body to validate.
 * @throws {Error} If any field violates a constraint.
 */
function validateResiliencePayload(payload) {
    const { enabled, forceMode, mode, triggers, weights } = payload;

    if (enabled !== undefined && typeof enabled !== 'boolean') {
        throw new Error('resilience.enabled must be a boolean');
    }
    if (forceMode !== undefined && typeof forceMode !== 'boolean') {
        throw new Error('resilience.forceMode must be a boolean');
    }
    if (mode !== undefined && !ALLOWED_MODES.includes(mode)) {
        throw new Error(`resilience.mode must be one of: ${ALLOWED_MODES.join(', ')}`);
    }

    if (triggers !== undefined) {
        const { maxEventLoopLag, maxMemoryHeap, maxConnections } = triggers;
        if (maxEventLoopLag !== undefined && (typeof maxEventLoopLag !== 'number' || maxEventLoopLag < 0)) {
            throw new Error('triggers.maxEventLoopLag must be a non-negative number');
        }
        if (maxMemoryHeap !== undefined && (typeof maxMemoryHeap !== 'number' || maxMemoryHeap < 0 || maxMemoryHeap > 100)) {
            throw new Error('triggers.maxMemoryHeap must be a number between 0 and 100');
        }
        if (maxConnections !== undefined && (typeof maxConnections !== 'number' || maxConnections < 0)) {
            throw new Error('triggers.maxConnections must be a non-negative number');
        }
    }

    if (weights !== undefined) {
        const { trust, activity, geo } = weights;
        const sum = (trust || 0) + (activity || 0) + (geo || 0);
        if (Math.abs(sum - 1.0) > 0.001) {
            throw new Error(`resilience weights must sum to 1.0 (got ${sum.toFixed(3)})`);
        }
        for (const [field, value] of Object.entries({ trust, activity, geo })) {
            if (value !== undefined && (typeof value !== 'number' || value < 0 || value > 1)) {
                throw new Error(`weights.${field} must be a number between 0 and 1`);
            }
        }
    }
}

/**
 * GET /client/:cid/resilience
 *
 * Returns the current resilience configuration for the given client.
 * If no document exists yet, responds with the default structure so the
 * modal can render without a prior save being required.
 * Key material (privateKey / privateKeyCipher) is never included in the response.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Function}                   next
 * @returns {Promise<void>}
 */
exports.getResilienceConfig = async (req, res, next) => {
    try {
        const { cid } = req.params;
        const userId   = req.user._id;
        const userRole = req.user.role;

        if (!cid) {
            return res.status(400).json({ success: false, error: 'Client ID required' });
        }

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const clientDoc = await Client.findOne({ cid }).select('resilience').lean();

        if (!clientDoc) {
            return res.status(404).json({ success: false, error: 'Client not found' });
        }

        const raw = clientDoc.resilience || {};

        // Strip any persisted private-key material before sending to the frontend.
        const { privateKeyCipher, privateKey, ...safeResilience } = raw;

        const response = {
            ...DEFAULT_RESILIENCE,
            ...safeResilience,
            triggers: { ...DEFAULT_RESILIENCE.triggers, ...(safeResilience.triggers || {}) },
            weights:  { ...DEFAULT_RESILIENCE.weights,  ...(safeResilience.weights  || {}) },
        };

        return res.status(200).json({ success: true, data: response });
    } catch (error) {
        console.error('[ResilienceController] Error fetching resilience config:', error);
        next(error);
    }
};

/**
 * POST /client/:cid/resilience
 *
 * Persists the resilience configuration for the given client.
 * Key material (keyId, publicKey, updatedAt) stored on the document is
 * preserved and never overwritten by this endpoint — use the dedicated
 * generate-keys endpoint to rotate keys.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Function}                   next
 * @returns {Promise<void>}
 */
exports.saveResilienceConfig = async (req, res, next) => {
    try {
        const { cid }  = req.params;
        const userId   = req.user._id;
        const userRole = req.user.role;

        if (!cid) {
            return res.status(400).json({ success: false, error: 'Client ID required' });
        }

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const { enabled, forceMode, mode, triggers, weights } = req.body;

        try {
            validateResiliencePayload({ enabled, forceMode, mode, triggers, weights });
        } catch (validationError) {
            return res.status(400).json({ success: false, error: validationError.message });
        }

        const clientDoc = await Client.findOne({ cid });

        if (!clientDoc) {
            return res.status(404).json({ success: false, error: 'Client not found' });
        }

        // Merge only the editable fields — never touch key material.
        const existing = clientDoc.resilience || {};

        clientDoc.resilience = {
            ...existing,
            ...(enabled   !== undefined && { enabled }),
            ...(forceMode !== undefined && { forceMode }),
            ...(mode      !== undefined && { mode }),
            ...(triggers  !== undefined && { triggers: { ...(existing.triggers || {}), ...triggers } }),
            ...(weights   !== undefined && { weights:  { ...(existing.weights  || {}), ...weights  } }),
        };

        clientDoc.markModified('resilience');
        await clientDoc.save();

        // Return the safe public view (no private key material).
        const { privateKeyCipher: _pkc, privateKey: _pk, ...safeResilience } = clientDoc.resilience;

        return res.status(200).json({
            success: true,
            message: 'Resilience configuration saved',
            data: safeResilience,
        });
    } catch (error) {
        console.error('[ResilienceController] Error saving resilience config:', error);
        next(error);
    }
};

/**
 * POST /client/:cid/resilience/generate-keys
 *
 * Generates a fresh ed25519 keypair for the given client.
 * The private key is written to the document and encrypted by the Client model's
 * pre-save hook before being stored. It is never returned to the caller.
 * The response includes only the public key and metadata needed by the frontend.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Function}                   next
 * @returns {Promise<void>}
 */
exports.generateResilienceKeys = async (req, res, next) => {
    try {
        const { cid }  = req.params;
        const userId   = req.user._id;
        const userRole = req.user.role;

        if (!cid) {
            return res.status(400).json({ success: false, error: 'Client ID required' });
        }

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const clientDoc = await Client.findOne({ cid });

        if (!clientDoc) {
            return res.status(404).json({ success: false, error: 'Client not found' });
        }

        const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
            publicKeyEncoding:  { type: 'spki',  format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });

        const keyId    = `kid_${crypto.randomBytes(4).toString('hex')}_${Date.now()}`;
        const updatedAt = new Date();

        // Write key material — the pre-save hook in Client.js will encrypt privateKey
        // into privateKeyCipher before persistence.
        clientDoc.resilience = {
            ...(clientDoc.resilience || {}),
            algorithm: 'ed25519',
            keyId,
            publicKey,
            privateKey,
            updatedAt,
        };

        clientDoc.markModified('resilience');
        await clientDoc.save();

        return res.status(200).json({
            success: true,
            message: 'Resilience keys generated. Private key is encrypted at rest.',
            data: {
                keyId,
                publicKey,
                algorithm: 'ed25519',
                updatedAt,
            },
        });
    } catch (error) {
        console.error('[ResilienceController] Error generating resilience keys:', error);
        next(error);
    }
};