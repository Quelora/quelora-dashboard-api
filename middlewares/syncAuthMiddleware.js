/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: middlewares/syncAuthMiddleware.js

/**
 * @file syncAuthMiddleware.js
 * @description Middleware to authenticate background synchronization requests from the WordPress integration.
 * It validates the incoming Bearer token against the client's configured Integration Secret (JWT Secret).
 *
 * @author Quelora Architecture Team
 */

const { getClientConfig } = require('@quelora/common/services/clientConfigService');

/**
 * Validates the Bearer token for synchronization endpoints.
 *
 * Extracts the Client ID (CID) from the request parameters and the token from the Authorization header.
 * It then retrieves the configured `login.jwtSecret` for the specified CID and performs a strict equality check.
 *
 * @async
 * @function syncAuthMiddleware
 * @param {import('express').Request} req - The Express request object containing `params.cid` and `headers.authorization`.
 * @param {import('express').Response} res - The Express response object used to send HTTP error statuses.
 * @param {import('express').NextFunction} next - The Express next middleware function.
 * @returns {Promise<void>} Executes next() if authenticated, otherwise sends a JSON error response.
 */
module.exports = async (req, res, next) => {
    const { cid } = req.params;

    if (!cid) {
        return res.status(400).json({
            success: false,
            message: 'Missing CID in URL parameters'
        });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'Unauthorized: Missing or invalid Bearer token'
        });
    }

    const token = authHeader.substring(7).trim();

    try {
        const jwtSecret = await getClientConfig(cid, 'login.jwtSecret');

        if (!jwtSecret) {
            return res.status(403).json({
                success: false,
                message: 'Forbidden: Client has no Integration Secret configured'
            });
        }

        if (token !== jwtSecret) {
            return res.status(403).json({
                success: false,
                message: 'Forbidden: Invalid Integration Secret'
            });
        }

        next();
    } catch (error) {
        console.error(`[SyncAuth] Error validating token for CID ${cid}:`, error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error during authentication'
        });
    }
};