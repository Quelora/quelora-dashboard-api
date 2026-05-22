/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: quelora-dashboard-api/middlewares/roleAuthMiddleware.js
const checkRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Unauthorized. User context missing.' });
        }

        const userRole = req.user.role;
        if (allowedRoles.includes(userRole)) {
            next();
        } else {
            console.warn(`⛔ Access denied: User ${req.user.username} (Role: ${userRole}) attempted to access resource protected for: ${allowedRoles.join(', ')}`);
            return res.status(403).json({ success: false, message: 'Forbidden. Insufficient permissions.' });
        }
    };
};

module.exports = checkRole;