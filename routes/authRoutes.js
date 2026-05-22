/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* quelora/routes/authRoutes.js */
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

const { globalRateLimiter, strictRateLimiter, loginRateLimiter } = require('@quelora/common/middlewares/rateLimiterMiddleware');
const responseCompressor = require('@quelora/common/middlewares/responseCompressor');

router.post('/generate-token', [globalRateLimiter, loginRateLimiter, responseCompressor], authController.generateToken);
router.post('/renew-token', [globalRateLimiter, strictRateLimiter, responseCompressor], authController.renewAdminToken);
router.post('/verify-2fa', [globalRateLimiter, loginRateLimiter, responseCompressor], authController.verifyTwoFactor);

router.post('/register',             [globalRateLimiter, strictRateLimiter, responseCompressor], authController.register);
router.post('/verify-email',         [globalRateLimiter, strictRateLimiter, responseCompressor], authController.verifyEmail);
router.post('/resend-verification',  [globalRateLimiter, strictRateLimiter, responseCompressor], authController.resendVerification);

router.get('/captcha',               [globalRateLimiter, strictRateLimiter],                     authController.getCaptcha);
router.post('/request-recovery',     [globalRateLimiter, strictRateLimiter, responseCompressor], authController.requestRecovery);
router.post('/verify-recovery',      [globalRateLimiter, strictRateLimiter, responseCompressor], authController.verifyRecovery);
router.post('/reset-password',       [globalRateLimiter, strictRateLimiter, responseCompressor], authController.resetPassword);

module.exports = router;