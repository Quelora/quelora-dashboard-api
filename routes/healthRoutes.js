/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: quelora-dashboard-api/routes/healthRoutes.js */
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    const healthcheck = {
        uptime: process.uptime(),
        message: 'OK',
        timestamp: Date.now()
    };
    try {
        res.send(healthcheck);
    } catch (e) {
        res.status(503).send({ error: 'Service Unavailable', details: e.message });
    }
});

module.exports = router;