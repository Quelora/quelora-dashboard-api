/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/**
 * @fileoverview Media routing module.
 * Exposes endpoints for general media uploads, utilizing the dynamic upload factory.
 */

const express = require('express');
const path = require('path');
const router = express.Router();

const authMiddleware = require('../middlewares/adminAuthMiddleware');
const createUploadMiddleware = require('../middlewares/uploadMiddleware');
const mediaController = require('../controllers/mediaController');

const publicPath = path.join(__dirname, '..', 'public');

const upload = createUploadMiddleware(publicPath, 'assets/ads', {
    fileSizeLimit: 25 * 1024 * 1024,
    allowedMimeTypes: ['image/', 'video/']
});

router.post(
    '/upload', 
    authMiddleware, 
    upload.single('media'), 
    mediaController.uploadMedia
);

module.exports = router;