/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: middlewares/integrationAuthMiddleware.js

/**
 * @file integrationAuthMiddleware.js
 * @description Middleware to authenticate integration config requests from the WordPress plugin.
 * Validates a short-lived HS256 JWT signed with the client's login.jwtSecret.
 *
 * The WordPress plugin generates this JWT natively (60s TTL) using the raw integration
 * secret from the connection string, which must match the client's configured jwtSecret.
 */

const jwt = require('jsonwebtoken');
const { getClientConfig } = require('@quelora/common/services/clientConfigService');

module.exports = async (req, res, next) => {
    const { cid } = req.params;

    if (!cid) {
        return res.status(400).json({ success: false, message: 'Missing CID in URL parameters' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Missing or invalid Bearer token' });
    }

    const token = authHeader.substring(7).trim();

    try {
        const jwtSecret = await getClientConfig(cid, 'login.jwtSecret');

        if (!jwtSecret) {
            return res.status(403).json({ success: false, message: 'Forbidden: Client has no Integration Secret configured' });
        }

        // Verify the short-lived JWT signed by the WP plugin with the client's jwtSecret.
        // jsonwebtoken checks the signature and exp claim automatically.
        jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Unauthorized: Integration token has expired' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(403).json({ success: false, message: 'Forbidden: Invalid Integration Secret' });
        }
        console.error(`[IntegrationAuth] Error validating token for CID ${cid}:`, error);
        return res.status(500).json({ success: false, message: 'Internal server error during authentication' });
    }
};
