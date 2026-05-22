/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: quelora-dashboard-api/middlewares/adminAuthMiddleware.js
const { validateToken } = require('@quelora/common/services/authService');
const User = require('../models/User');

/**
 * Admin Authentication middleware.
 *
 * - Extracts and validates a Bearer token from the Authorization header.
 * - Validates using the global Admin JWT Secret by explicitly passing isAdmin = true.
 * - Fetches the User document from the database and attaches it to `req.user`.
 *
 * @async
 * @function authMiddleware
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
async function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Token not provided or incorrect format.' });
    }

    const token = authHeader.split(' ')[1];
    const clientIp = req.ip;

    try {
        // ARCHITECTURAL UPDATE: 
        // Await the promise. Pass cid = null, and isAdmin = true to bypass tenant logic.
        const payload = await validateToken(token, clientIp, null, true);

        if (!payload.userId) {
            return res.status(401).json({ message: 'Invalid token payload.' });
        }

        const user = await User.findById(payload.userId).setOptions({ loadClients: false });

        if (!user) {
            return res.status(401).json({ message: 'User not found.' });
        }
        
        req.user = user;
        
        next();
    } catch (error) {
        return res.status(401).json({ message: error.message });
    }
}

module.exports = authMiddleware;