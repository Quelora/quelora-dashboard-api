/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/**
 * @fileoverview System user management routes.
 *
 * All routes require admin authentication via {@link adminAuthMiddleware}.
 * Role-level enforcement is delegated to the controller — the middleware
 * chain only verifies that a valid admin session exists.
 *
 * @module routes/userRoutes
 */

const express = require('express');
const router  = express.Router();

const userController      = require('../controllers/userController');
const { globalRateLimiter, strictRateLimiter } = require('@quelora/common/middlewares/rateLimiterMiddleware');
const adminAuthMiddleware = require('../middlewares/adminAuthMiddleware');
const responseCompressor  = require('@quelora/common/middlewares/responseCompressor');
const checkRole           = require('../middlewares/roleAuthMiddleware');

const CREATE_ROLES = ['god', 'admin'];

router.get(
    '/profile',
    [globalRateLimiter, adminAuthMiddleware, responseCompressor],
    userController.getProfile
);

/**
 * Returns the encrypted client list for the authenticated user's current
 * active context.
 *
 * Called by the frontend immediately after `/admin/set` resolves so that
 * the `clients` key in storage is replaced with the new CID's payload.
 * Without this call the frontend keeps using the previous CID as query
 * parameter in every data-fetching request.
 *
 * No rate-limit beyond globalRateLimiter — this is a lightweight Redis +
 * single-document MongoDB read and must resolve quickly after a CID switch.
 */
router.get(
    '/clients',
    [globalRateLimiter, adminAuthMiddleware, responseCompressor],
    userController.getSessionClients
);

router.patch(
    '/profile',
    [globalRateLimiter, adminAuthMiddleware, strictRateLimiter, responseCompressor],
    userController.updateProfile
);

router.post(
    '/change-password',
    [globalRateLimiter, adminAuthMiddleware, strictRateLimiter, responseCompressor],
    userController.updatePassword
);

router.post(
    '/2fa/setup',
    [globalRateLimiter, adminAuthMiddleware, strictRateLimiter],
    userController.setupTwoFactor
);

router.post(
    '/2fa/verify',
    [globalRateLimiter, adminAuthMiddleware, strictRateLimiter],
    userController.verifyTwoFactorSetup
);

router.post(
    '/2fa/disable',
    [globalRateLimiter, adminAuthMiddleware, strictRateLimiter],
    userController.disableTwoFactor
);

router.get(
    '/list',
    [globalRateLimiter, adminAuthMiddleware, responseCompressor],
    userController.getManagedUsers
);

router.post(
    '/create',
    [globalRateLimiter, adminAuthMiddleware, strictRateLimiter, checkRole(CREATE_ROLES)],
    userController.createUser
);

router.post(
    '/:userId/reset-password',
    [globalRateLimiter, adminAuthMiddleware, strictRateLimiter, checkRole(CREATE_ROLES)],
    userController.resetUserPassword
);

router.delete(
    '/:userId',
    [globalRateLimiter, adminAuthMiddleware, strictRateLimiter, checkRole(CREATE_ROLES)],
    userController.deleteSystemUser
);

router.patch(
    '/:userId/restore',
    [globalRateLimiter, adminAuthMiddleware, strictRateLimiter, checkRole(CREATE_ROLES)],
    userController.restoreSystemUser
);

router.patch(
    '/:userId/unlock',
    [globalRateLimiter, adminAuthMiddleware, strictRateLimiter, checkRole(CREATE_ROLES)],
    userController.unlockUser
);

router.patch(
    '/:userId',
    [globalRateLimiter, adminAuthMiddleware, strictRateLimiter, checkRole(CREATE_ROLES)],
    userController.updateSystemUser
);

router.patch(
    '/:userId/enterprise',
    [globalRateLimiter, adminAuthMiddleware, strictRateLimiter, checkRole(['god'])],
    userController.updateUserEnterprise
);

module.exports = router;