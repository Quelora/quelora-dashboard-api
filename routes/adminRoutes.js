/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const suggestionController = require('../controllers/suggestionController');

const { globalRateLimiter } = require('@quelora/common/middlewares/rateLimiterMiddleware');
const adminAuthMiddleware = require('../middlewares/adminAuthMiddleware');
const checkRole = require('../middlewares/roleAuthMiddleware');

const GOD_ROLES = ['god']; 

router.get('/search',  [ globalRateLimiter, adminAuthMiddleware, checkRole(GOD_ROLES) ], adminController.searchClients);
router.post('/set',  [ globalRateLimiter, adminAuthMiddleware, checkRole(GOD_ROLES) ], adminController.setActiveClient);
router.post('/jobs/suggestions', [ globalRateLimiter, adminAuthMiddleware, checkRole(GOD_ROLES) ], suggestionController.triggerSuggestionJob );

module.exports = router;