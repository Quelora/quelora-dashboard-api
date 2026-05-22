/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: quelora-dashboard-api/controllers/mediaController.js
const express = require('express');

exports.uploadMedia = (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file was uploaded.' });
    }
    
    const mediaUrl = `/assets/ads/${req.file.filename}`;
    const mediaType = req.file.mimetype.startsWith('image/') ? 'image' : 'video';

    res.status(201).json({
        success: true,
        data: {
            mediaUrl: mediaUrl,
            mediaType: mediaType
        }
    });
};