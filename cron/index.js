/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: ./cron/index.js */
const shouldRunCrons = process.env.RUN_CRONS === 'true';

const safeRequire = (path) => {
    try {
        require(path);
    } catch (error) {
        console.error(`❌ [Cron Error] Failed to load job: ${path}`);
        console.error(error);
    }
};