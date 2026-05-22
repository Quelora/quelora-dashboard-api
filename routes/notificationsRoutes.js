/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const express = require('express');
const router = express.Router();
const notificationsController = require('../controllers/notificationsController');
const adminAuthMiddleware = require('../middlewares/adminAuthMiddleware');
const checkRole = require('../middlewares/roleAuthMiddleware');

const { globalRateLimiter, strictRateLimiter } = require('@quelora/common/middlewares/rateLimiterMiddleware');

const SETTINGS_ROLES = ['god','admin'];

router.post('/send', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(SETTINGS_ROLES)], notificationsController.sendNotification);
router.post('/send-mail', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(SETTINGS_ROLES)], notificationsController.sendMail);

router.get('/search', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(SETTINGS_ROLES)], notificationsController.searchAuthors);
router.get('/generate-vapid-keys', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware, checkRole(SETTINGS_ROLES)], notificationsController.generateVapidKeys);

module.exports = router;    