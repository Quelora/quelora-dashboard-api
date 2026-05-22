/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./routes/statsRoutes.js
const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const adminAuthMiddleware = require('../middlewares/adminAuthMiddleware');
const { globalRateLimiter, strictRateLimiter } = require('@quelora/common/middlewares/rateLimiterMiddleware');
const responseCompressor = require('@quelora/common/middlewares/responseCompressor');
const checkRole = require('../middlewares/roleAuthMiddleware');

const ANALYTICS_ROLES = ['god','admin', 'analyst'];

router.get('/get',[ globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(ANALYTICS_ROLES), responseCompressor], statsController.getSystemStats);
router.get('/get/geo',[ globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(ANALYTICS_ROLES) , responseCompressor], statsController.searchGeoStats);
router.get('/get/posts/list',[ globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(ANALYTICS_ROLES), responseCompressor], statsController.getPostListStats);
router.get('/get/post/:entity',[ globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(ANALYTICS_ROLES), responseCompressor], statsController.getPostAnalytics);
router.get('/get/top-users/comments',[ globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(ANALYTICS_ROLES), responseCompressor], statsController.getTopUsersByComments);
router.get('/get/profile-analytics',[ globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(ANALYTICS_ROLES), responseCompressor], statsController.getProfileAnalytics);
router.get('/get/moderation-analytics',[ globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(ANALYTICS_ROLES), responseCompressor], statsController.getModerationAnalytics);
router.get('/get/users/:author/reputation', [ globalRateLimiter,  strictRateLimiter,  adminAuthMiddleware,  checkRole(ANALYTICS_ROLES),  responseCompressor], statsController.getUserReputationLogs);

module.exports = router;