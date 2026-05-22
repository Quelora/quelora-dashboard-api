/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-dashboard-api/seed/triggerFullScan.js */
require('dotenv').config({ path: '../../../.env' }); 
const { Queue } = require('bullmq');
const { cacheClient } = require('../../quelora-common/services/cacheService'); 

const QUEUE_NAME = 'gravity-decay'; 

const trigger = async () => {
    console.log('🔌 Conectando a Redis...');
    const gravityQueue = new Queue(QUEUE_NAME, { connection: cacheClient });

    console.log(`🚀 Inyectando RECALCULO TOTAL (100%) en cola: ${QUEUE_NAME}...`);

    await gravityQueue.add(
        'manual-full-trigger', 
        { 
            cid: 'MANUAL_FULL_SCAN',
            forceAll: true 
        }, 
        { removeOnComplete: true, removeOnFail: true }
    );

    console.log('✅ Trabajo enviado. El worker procesará TODOS los comentarios históricos.');
    
    await gravityQueue.close();
    process.exit(0);
};

trigger().catch(console.error);