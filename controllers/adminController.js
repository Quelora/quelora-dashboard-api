/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// packages/quelora-dashboard-api/controllers/adminController.js
const Client = require('@quelora/common/models/Client');
const { cacheService } = require('@quelora/common/services/cacheService');

exports.searchClients = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || typeof q !== 'string' || q.length < 2) {
            return res.status(200).json([]); 
        }

        const safeQuery = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(safeQuery, 'i');
        const clients = await Client.find({
            $or: [
                { cid: regex },
                { description: regex }
            ]
        })
        .select('cid description')
        .limit(20) 
        .lean(); 

        return res.status(200).json(clients);

    } catch (error) {
        console.error('Error searching clients (admin):', error);
        return res.status(500).json({ error: 'Internal server error searching clients' });
    }
};

exports.setActiveClient = async (req, res) => {
    try {
        const { cid } = req.body;
        const userId = req.user._id || req.user.id;

        if (!cid) {
            return res.status(400).json({ error: 'CID is required' });
        }

        const clientExists = await Client.exists({ cid });
        if (!clientExists) {
            return res.status(404).json({ error: 'Client not found' });
        }

        const cacheKey = `active_cid:${userId}`;
        await cacheService.set(cacheKey, { cid }, 86400);

        const client = await Client.findOne({ cid }).lean();
        
        return res.status(200).json({
            success: true,
            message: `Active client set to ${cid}`,
            client: {
                cid: client.cid,
                description: client.description,
                apiUrl: client.apiUrl,
                siteUrl: client.siteUrl,
                config: client.config,
                postConfig: client.postConfig,
                vapid: client.vapid,
                email: client.email,
                turn: client.turn,
                nostr: client.nostr,
                p2p: client.p2p,
                resilience: client.resilience
            }
        });
    } catch (error) {
        console.error('Error setting active client:', error);
        return res.status(500).json({ error: 'Internal server error setting active client' });
    }
};