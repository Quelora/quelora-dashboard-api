/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// src/controllers/reputationController.js
const ReputationConfig = require('@quelora/common/models/ReputationConfig'); // Assuming model exists in common
const { validateCidAccess } = require('../utils/accessControl'); // Helper you use in clientController

/**
 * GET /reputation/:cid
 */
exports.getClientReputationConfig = async (req, res, next) => {
    try {
        const { cid } = req.params;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!cid) return res.status(400).json({ success: false, error: 'Client ID required' });

        // Access Control
        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        let config = await ReputationConfig.findOne({ cid }).lean();

        if (!config) {
            // Return default structure if not found (don't save yet)
            return res.status(200).json({
                success: true,
                data: {
                    cid,
                    weights: {
                        helpful_mark: 10, pinned: 50, correction: 20, upvote: 1, downvote: -2,
                        spam_report: -50, mod_removal: -100, post_created: 0, reply_created: 0
                    },
                    limits: { max_daily_reputation_gain: 100, decay_rate: 0.05 },
                    trust_levels: [
                        { lvl: 0, min: -Infinity, label: "Novice" },
                        { lvl: 1, min: 0, label: "Member" },
                        { lvl: 2, min: 50, label: "Trusted" }
                    ]
                }
            });
        }

        res.status(200).json({ success: true, data: config });
    } catch (error) {
        console.error('Error fetching reputation config:', error);
        next(error);
    }
};

/**
 * PUT /reputation/:cid
 */
exports.updateClientReputationConfig = async (req, res, next) => {
    try {
        const { cid } = req.params;
        const { weights, limits, trust_levels } = req.body;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!cid) return res.status(400).json({ success: false, error: 'Client ID required' });

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Upsert configuration
        const config = await ReputationConfig.findOneAndUpdate(
            { cid },
            { 
                $set: { 
                    weights, 
                    limits, 
                    trust_levels,
                    updated_at: new Date()
                } 
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        res.status(200).json({ success: true, message: 'Reputation config saved', data: config });
    } catch (error) {
        console.error('Error updating reputation config:', error);
        next(error);
    }
};