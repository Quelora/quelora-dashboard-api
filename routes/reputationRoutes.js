/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// src/routes/reputationRoutes.js
const express = require('express');
const router = express.Router();
const reputationController = require('../controllers/reputationController');

const { globalRateLimiter, strictRateLimiter } = require('@quelora/common/middlewares/rateLimiterMiddleware');
const adminAuthMiddleware = require('../middlewares/adminAuthMiddleware');
const responseCompressor = require('@quelora/common/middlewares/responseCompressor');
const checkRole = require('../middlewares/roleAuthMiddleware');

// Only Admins/Gods should change trust mechanics
const SETTINGS_ROLES = ['god', 'admin']; 

router.get('/:cid', [
    globalRateLimiter, 
    strictRateLimiter, 
    adminAuthMiddleware, 
    checkRole(SETTINGS_ROLES), 
    responseCompressor
], reputationController.getClientReputationConfig);

router.put('/:cid', [
    globalRateLimiter, 
    strictRateLimiter, 
    adminAuthMiddleware, 
    checkRole(SETTINGS_ROLES), 
    responseCompressor
], reputationController.updateClientReputationConfig);

module.exports = router;