/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: app.js */

// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const http = require('http'); 
const cors = require('cors');
const path = require('path');

// Common Quelora modules
const helmetConfig = require('@quelora/common/config/helmetConfig');
const dynamicCorsConfig = require('@quelora/common/config/dynamicCorsConfig');
const connectDB = require('@quelora/common/db'); 

// Local modules
const setupRoutes = require('./routes/routes'); 

// Custom Middlewares
const requestLogger = require('@quelora/common/middlewares/requestLogger');
const cacheInvalidator = require('@quelora/common/middlewares/cacheInvalidator');
const globalErrorHandler = require('@quelora/common/middlewares/globalErrorHandler');

//Socket Sentinel Debug Service
const { initializeSentinelBrokerServer } = require('./services/sentinelDebugBrokerService');

// --- Initialization ---

// Connect to the database
connectDB();

// Initialize Express app
const app = express();
const port = process.env.PORT;
const baseURL = process.env.BASE_URL;

// Trust the proxy for IPs
app.set('trust proxy', 2);

// --- Core Middlewares ---

// Serve static assets with open CORS
app.use('/assets', (req, res, next) => {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
    });
    express.static(path.join(__dirname, 'public/assets'))(req, res, next);
});

// Security headers
app.use(helmetConfig); 

// CORS handling
app.use(cors(dynamicCorsConfig));
app.options('*', cors(dynamicCorsConfig));

// Body parsers
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

// --- Custom Middlewares ---

// Log all incoming requests
app.use(requestLogger);

// Automatically invalidate cache on data-mutating requests (POST, PUT, etc.)
app.use(cacheInvalidator);

// --- Application Setup ---

// Load all API routes
setupRoutes(app); 

// Initialize and schedule all cron jobs
require('./cron');

// Global error handler (must be loaded AFTER routes)
app.use(globalErrorHandler);

// --- Server Startup ---

const server = http.createServer(app);

// -- Activate Socket Sentinel Debug Service --
initializeSentinelBrokerServer(server);

server.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running ${baseURL}`);
});