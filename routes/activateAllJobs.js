/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-jobs/scripts/activateAllJobs.js */
require('dotenv').config();
const { mongoose } = require('@quelora/common/db');
const Client = require('@quelora/common/models/Client');

// Configuración "Full Power" (Todo activado)
const FULL_CONFIG = {
    // --- Core Jobs ---
    reputation:   { enabled: true, cronExpression: '*/30 * * * * *' }, // Cada 30s
    suggestion:   { enabled: true, cronExpression: '0 2 * * *' },      // 2:00 AM
    activity:     { enabled: true, cronExpression: '*/10 * * * * *' }, // Cada 10s
    
    // --- Enterprise Jobs ---
    gamification: { enabled: true, cronExpression: '*/5 * * * * *' },  // Cada 5s
    'ad-stats':   { enabled: true, cronExpression: '*/30 * * * * *' }  // Cada 30s
};

const run = async () => {
    try {
        if (!process.env.MONGO_URI) throw new Error('MONGO_URI missing');
        
        console.log('🔌 Connecting to DB...');
        await mongoose.connect(process.env.MONGO_URI);
        
        const clients = await Client.find({});
        console.log(`🔍 Found ${clients.length} clients.`);

        for (const client of clients) {
            // Asegurar que jobsConfig es un Map (si tu esquema usa Map)
            if (!client.jobsConfig) {
                client.jobsConfig = new Map();
            }

            // Inyectar o Sobreescribir configuración
            for (const [key, config] of Object.entries(FULL_CONFIG)) {
                // Opción A: Solo agregar si falta (Conservador)
                // if (!client.jobsConfig.get(key)) { client.jobsConfig.set(key, config); }
                
                // Opción B: Forzar activación (Lo que pediste: "Update para todos")
                client.jobsConfig.set(key, config);
            }

            // Marcar como modificado para que Mongoose guarde cambios en Maps
            client.markModified('jobsConfig');
            
            await client.save();
            console.log(`✅ [${client.cid}] All jobs activated.`);
        }

        console.log('🚀 Update Complete.');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

run();