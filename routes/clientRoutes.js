/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./routes/clientRoutes.js
const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');

const { globalRateLimiter, strictRateLimiter } = require('@quelora/common/middlewares/rateLimiterMiddleware');
const adminAuthMiddleware = require('../middlewares/adminAuthMiddleware');
const responseCompressor = require('@quelora/common/middlewares/responseCompressor');
const checkRole = require('../middlewares/roleAuthMiddleware');

const SETTINGS_ROLES = ['god','admin']; 
const CONTENT_ROLES = ['god','admin', 'moderator'];
const GENERAL_ROLES = ['god','admin', 'moderator','advertiser'];

router.post('/generate-cid', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(SETTINGS_ROLES)], clientController.upsertClient);
router.put('/update-cid', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(SETTINGS_ROLES)], clientController.upsertClient);
router.post('/upsert', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(SETTINGS_ROLES), responseCompressor], clientController.upsertClient);
router.get('/post/:cid/:entity/', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(CONTENT_ROLES), responseCompressor], clientController.getPost);
router.get('/posts', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(GENERAL_ROLES), responseCompressor], clientController.getClientPosts);
router.get('/posts/:postId/', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(CONTENT_ROLES), responseCompressor], clientController.getPostComments);
router.put('/upsert-post',[ globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(CONTENT_ROLES), responseCompressor], clientController.upsertPost);
router.patch('/trash',[globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(CONTENT_ROLES), responseCompressor], clientController.trashPost);
router.patch('/restore', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(CONTENT_ROLES), responseCompressor], clientController.restorePostFromTrash);
router.post('/moderation', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(CONTENT_ROLES), responseCompressor], clientController.moderationTest);

router.post('/:cid/test-toxicity', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(SETTINGS_ROLES), responseCompressor], clientController.testToxicity);

router.delete('/delete/:cid', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(CONTENT_ROLES), responseCompressor], clientController.deleteClient);

router.get('/test', [ ], clientController.testDiscovery);
router.post('/test-geolocation', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(SETTINGS_ROLES)], clientController.testGeolocation);
router.post('/force-geo-update', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(SETTINGS_ROLES)], clientController.forceGeoUpdate);

router.get('/users', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(CONTENT_ROLES), responseCompressor], clientController.getUsersByClient);
router.get('/users/:author/stats', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(CONTENT_ROLES), responseCompressor], clientController.getUserCommentStats);
router.get('/users/:author/nolan', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(CONTENT_ROLES), responseCompressor], clientController.analyzeAuthorNolanChart);
router.get('/users/:author/comments-list', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(CONTENT_ROLES), responseCompressor], clientController.getCommentsListByUser);
router.patch('/users/:author/ban', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(CONTENT_ROLES), responseCompressor], clientController.banUser);
router.patch('/users/:author/unban', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(CONTENT_ROLES), responseCompressor], clientController.unbanUser);
router.get('/logs', [globalRateLimiter, strictRateLimiter,adminAuthMiddleware, checkRole(CONTENT_ROLES), responseCompressor], clientController.getMonitoring);

router.get('/reports', [globalRateLimiter, strictRateLimiter,adminAuthMiddleware, checkRole(CONTENT_ROLES), responseCompressor], clientController.getReports);
router.patch('/reports/:reportId/resolve', [globalRateLimiter, strictRateLimiter,adminAuthMiddleware, checkRole(CONTENT_ROLES), responseCompressor], clientController.resolveReport);

router.patch('/comments/:commentId/hide', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(CONTENT_ROLES)], clientController.hideComment);
router.patch('/comments/:commentId/unhide', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(CONTENT_ROLES)], clientController.unhideComment);

router.patch('/:cid/quick-setup', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(SETTINGS_ROLES), responseCompressor], clientController.quickSetup);

router.patch('/:cid/modules', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(SETTINGS_ROLES)], clientController.updateClientModules);

module.exports = router;