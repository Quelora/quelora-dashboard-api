/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: packages/quelora-dashboard-api/routes/jobsRoutes.js
const express = require('express');
const router  = express.Router();

const jobsController   = require('../controllers/jobsController');
const { globalRateLimiter, strictRateLimiter } = require('@quelora/common/middlewares/rateLimiterMiddleware');
const adminAuthMiddleware = require('../middlewares/adminAuthMiddleware');
const checkRole           = require('../middlewares/roleAuthMiddleware');
const responseCompressor  = require('@quelora/common/middlewares/responseCompressor');

const ADMIN_ROLES = ['god', 'admin'];

router.get(
    '/',
    [globalRateLimiter, adminAuthMiddleware, checkRole(ADMIN_ROLES), responseCompressor],
    jobsController.getJobs
);

router.get(
    '/logs',
    [globalRateLimiter, adminAuthMiddleware, checkRole(ADMIN_ROLES), responseCompressor],
    jobsController.getLogs
);

router.patch(
    '/:jobKey',
    [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(ADMIN_ROLES)],
    jobsController.updateJob
);

router.post(
    '/:jobKey/trigger',
    [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(ADMIN_ROLES)],
    jobsController.triggerJob
);

module.exports = router;
