/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-jobs/scripts/initJobsConfig.js */
require('dotenv').config();
const { mongoose } = require('@quelora/common/db');
const Client = require('@quelora/common/models/Client');

// Configuración Maestra: Incluye Core, Enterprise y Maintenance Jobs
const DEFAULT_JOBS = {
    // --- CORE (Vitales) ---
    reputation:     { enabled: true, cronExpression: '*/30 * * * * *' }, // 30s
    suggestion:     { enabled: true, cronExpression: '0 2 * * *' },      // 2 AM
    activity:       { enabled: true, cronExpression: '*/10 * * * * *' }, // 10s
    
    // --- MANTENIMIENTO (Nuevo Ranking Inteligente) ---
    'gravity-decay': { enabled: true, cronExpression: '*/30 * * * *' },   // 30m

    // --- ENTERPRISE (Opcionales, pero seguros de definir por defecto) ---
    gamification:   { enabled: true, cronExpression: '*/5 * * * * *' },  // 5s (Alta frecuencia)
    'ad-stats':     { enabled: true, cronExpression: '*/5 * * * * *' }   // 5s
};

const migrate = async () => {
    try {
        if (!process.env.MONGO_URI) {
            throw new Error('MONGO_URI not defined in env');
        }

        console.log('🔌 Connecting to DB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected.');

        const clients = await Client.find({});
        console.log(`🔍 Found ${clients.length} clients. Checking for migrations...`);

        let updatedCount = 0;

        for (const client of clients) {
            let modified = false;

            // Garantizar que jobsConfig es un objeto inicializado
            if (!client.jobsConfig) {
                client.jobsConfig = {};
            }

            // Verificar cada job por defecto
            for (const [key, config] of Object.entries(DEFAULT_JOBS)) {
                
                // Verificamos si existe la key en el objeto de configuración
                // Nota: Usamos acceso directo de objeto/mongoose en lugar de .get() de Map
                // para compatibilidad con esquemas Mixed/Subdocument
                const existingConfig = client.jobsConfig[key];

                if (!existingConfig) {
                    console.log(`🛠️ [${client.cid}] Adding missing job config: ${key}`);
                    
                    // Mongoose detecta cambios mejor si asignamos al path completo o usamos markModified
                    client.jobsConfig[key] = config;
                    
                    // Si jobsConfig es un Mixed Type, necesitamos avisar a Mongoose
                    client.markModified(`jobsConfig.${key}`);
                    modified = true;
                }
            }

            if (modified) {
                // Marcar todo el objeto jobsConfig como modificado por seguridad
                client.markModified('jobsConfig');
                
                await client.save();
                updatedCount++;
                console.log(`💾 [${client.cid}] Saved updates.`);
            } else {
                console.log(`✨ [${client.cid}] Already up to date.`);
            }
        }

        console.log(`🚀 Migration complete. Updated ${updatedCount} clients.`);
        process.exit(0);

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
};

migrate();