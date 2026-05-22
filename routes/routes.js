/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./routes/routes.js
const path = require('path');
const { loadOptionalModule } = require('@quelora/common/utils/featureLoader');

const authRoutes         = require('./authRoutes');
const statsRoutes        = require('./statsRoutes');
const clientRoutes       = require('./clientRoutes');
const userRoutes         = require('./userRoutes');
const notificationsRoutes = require('./notificationsRoutes');
const mediaRoutes        = require('./mediaRoutes');
const adminRoutes        = require('./adminRoutes');
const healthRoutes       = require('./healthRoutes');
const reputationRoutes   = require('./reputationRoutes');
const resilienceRoutes   = require('./resilienceRoutes');
const syncRoutes         = require('./syncRoutes');
const jobsRoutes         = require('./jobsRoutes');

const adminAuthMiddleware = require('../middlewares/adminAuthMiddleware');
const checkRole           = require('../middlewares/roleAuthMiddleware');

const Enterprise = loadOptionalModule('@quelora/enterprise');

const PUBLIC_PATH = path.join(__dirname, '../public');

/**
 * Registers all application routes on the provided Express instance.
 *
 * Route prefixes:
 * - /health          — liveness and readiness probes
 * - /notifications   — push-notification management
 * - /stats           — aggregated analytics
 * - /auth            — authentication and session handling
 * - /client          — client CRUD and per-client sub-resources
 * - /media           — media upload and retrieval
 * - /user            — user profile operations
 * - /admin           — back-office administration
 * - /reputation      — per-client reputation configuration
 *
 * Resilience and Sync routes are mounted under /client so that the :cid parameter
 * follows the existing /client/:cid/* convention used throughout the API.
 *
 * @param {import('express').Application} app - The Express application instance.
 */
module.exports = (app) => {
    app.use('/health',         healthRoutes);
    app.use('/notifications',  notificationsRoutes);
    app.use('/stats',          statsRoutes);
    app.use('/auth',           authRoutes);
    app.use('/client',         clientRoutes);
    app.use('/client',         resilienceRoutes);
    app.use('/client',         syncRoutes);
    app.use('/media',          mediaRoutes);
    app.use('/user',           userRoutes);
    app.use('/admin',          adminRoutes);
    app.use('/reputation',     reputationRoutes);
    app.use('/jobs',           jobsRoutes);

    if (Enterprise) {
        const deps = {
            adminAuthMiddleware,
            checkRole,
            publicPath: PUBLIC_PATH,
        };

        if (Enterprise.gamificationDashboardRoutes) {
            console.log('💎 Enterprise: Gamification Dashboard enabled');
            app.use('/gamification', Enterprise.gamificationDashboardRoutes(deps));
        }
        if (Enterprise.adCampaignRoutes) {
            console.log('💎 Enterprise: Ad Campaigns enabled');
            app.use('/client/campaigns', Enterprise.adCampaignRoutes(deps));
        }
        if (Enterprise.placementRoutes) {
            console.log('💎 Enterprise: Ad Placements enabled');
            app.use('/client/placements', Enterprise.placementRoutes(deps));
        }
        if (Enterprise.placementPricingRoutes) {
            console.log('💎 Enterprise: Ad Pricing enabled');
            app.use('/client/placement-pricing', Enterprise.placementPricingRoutes(deps));
        }
        if (Enterprise.advertiserProfileRoutes) {
            console.log('💎 Enterprise: Advertiser Profiles enabled');
            app.use('/client/advertiser-profiles', Enterprise.advertiserProfileRoutes(deps));
        }
        if (Enterprise.surveyDashboardRoutes) {
            console.log('💎 Enterprise: Survey Dashboard enabled');
            app.use('/client', Enterprise.surveyDashboardRoutes(deps));
        }
    }
};