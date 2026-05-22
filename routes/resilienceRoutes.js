/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./routes/resilienceRoutes.js
const express = require('express');
const router  = express.Router();

const resilienceController = require('../controllers/resilienceController');

const { globalRateLimiter, strictRateLimiter } = require('@quelora/common/middlewares/rateLimiterMiddleware');
const adminAuthMiddleware  = require('../middlewares/adminAuthMiddleware');
const responseCompressor   = require('@quelora/common/middlewares/responseCompressor');
const checkRole            = require('../middlewares/roleAuthMiddleware');

/** Roles allowed to read or write resilience settings. */
const SETTINGS_ROLES = ['god', 'admin'];

/**
 * GET /client/:cid/resilience
 * Returns the current resilience configuration for the given client.
 */
router.get(
    '/:cid/resilience',
    [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(SETTINGS_ROLES), responseCompressor],
    resilienceController.getResilienceConfig
);

/**
 * POST /client/:cid/resilience
 * Persists the editable resilience configuration (mode, triggers, weights).
 * Key material is never modified by this endpoint.
 */
router.post(
    '/:cid/resilience',
    [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(SETTINGS_ROLES)],
    resilienceController.saveResilienceConfig
);

/**
 * POST /client/:cid/resilience/generate-keys
 * Rotates the ed25519 keypair for the given client.
 * The private key is encrypted server-side and never returned to the caller.
 */
router.post(
    '/:cid/resilience/generate-keys',
    [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(SETTINGS_ROLES)],
    resilienceController.generateResilienceKeys
);

module.exports = router;