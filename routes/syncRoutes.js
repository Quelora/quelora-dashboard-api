/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: routes/syncRoutes.js

/**
 * @file syncRoutes.js
 * @description Express router for handling background synchronization requests from WordPress.
 * Maps both legacy (/sync/) and modern (/v1/) endpoints to the sync controller,
 * protected by the synchronization authentication middleware.
 *
 * @author Quelora Architecture Team
 */

const express = require('express');
const router = express.Router();
const syncController = require('../controllers/syncController');
const syncAuthMiddleware = require('../middlewares/syncAuthMiddleware');
const integrationAuthMiddleware = require('../middlewares/integrationAuthMiddleware');

/**
 * Route: POST /:cid/v1/integration/config
 * Endpoint for the WordPress plugin wizard to securely fetch the client configuration.
 * Protected by a short-lived HS256 JWT signed with the client's integration secret.
 * Must be defined BEFORE the syncAuthMiddleware router.use so it uses its own auth.
 */
router.post('/:cid/v1/integration/config', integrationAuthMiddleware, syncController.getIntegrationConfig);

// Apply the raw-secret validation middleware to all batch-sync routes.
router.use('/:cid/v1', syncAuthMiddleware);
router.use('/:cid/sync', syncAuthMiddleware);

/**
 * Route: POST /:cid/v1/nodes/batch-upsert
 * Route: POST /:cid/sync/nodes/batch-upsert
 * Endpoint for batch upserting nodes (posts) originating from the WordPress integration.
 * Supports both modern and legacy paths for seamless, zero-downtime migration.
 */
router.post(
    ['/:cid/v1/nodes/batch-upsert', '/:cid/sync/nodes/batch-upsert'],
    syncController.batchUpsertNodes
);

/**
 * Route: POST /:cid/v1/profiles/batch-upsert
 * Route: POST /:cid/sync/profiles/batch-upsert
 * Endpoint for batch upserting profiles (users) originating from the WordPress integration.
 * Supports both modern and legacy paths for seamless, zero-downtime migration.
 */
router.post(
    ['/:cid/v1/profiles/batch-upsert', '/:cid/sync/profiles/batch-upsert'],
    syncController.batchUpsertProfiles
);

module.exports = router;
