/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: quelora-enterprise/seed/migrateResilienceConfig.js */

/**
 * @file migrateResilienceConfig.js
 * @description Script de migración BLINDADO.
 * Usa acceso directo a la colección (driver nativo) para evitar que Mongoose Schema Strict Mode
 * elimine los campos nuevos si el modelo Client.js no está actualizado.
 */

require('dotenv').config();

// --- 1. Loader Robusto ---
const loadOptionalModule = (moduleName, localPath) => {
    try {
        return require(moduleName);
    } catch (error) {
        if (localPath) {
            try {
                return require(localPath);
            } catch (e) {
                console.error(`Failed to load module ${moduleName} or path ${localPath}:`, e.message);
                return null;
            }
        }
        return null;
    }
};

// Carga de dependencias
let dbModule = loadOptionalModule('@quelora/common/db', '../../quelora-common/db');
if (!dbModule) dbModule = { mongoose: require('mongoose') };
const { mongoose } = dbModule;

const Client = loadOptionalModule('@quelora/common/models/Client', '../../quelora-common/models/Client');

if (!Client) {
    console.error('❌ Error CRÍTICO: No se pudo cargar el modelo Client.');
    process.exit(1);
}

// --- 2. Configuración Base ---
const DEFAULT_RESILIENCE_CONFIG = {
    // Nota: 'enabled' lo dejamos como esté en la DB o true si no existe, 
    // para no apagarle la resiliencia a quien ya tenga llaves.
    mode: 'STANDBY',
    forceMode: false,
    triggers: {
        maxEventLoopLag: 200,
        maxMemoryHeap: 85,
        maxConnections: 0
    },
    weights: {
        trust: 0.4,
        activity: 0.4,
        geo: 0.2
    }
};

const migrate = async () => {
    const dbUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/quelora';

    try {
        console.log('🔌 Conectando a MongoDB...');
        await mongoose.connect(dbUri);
        
        console.log('🔍 Escaneando Clientes...');
        // Usamos lean() para obtener objetos JS puros y ver qué hay realmente en la DB
        const clients = await Client.find({}).lean();
        console.log(`📋 Encontrados ${clients.length} clientes.`);

        let updatedCount = 0;

        for (const client of clients) {
            const currentRes = client.resilience || {};
            const updates = {};
            let needsUpdate = false;

            // 1. Validar Mode
            if (!currentRes.mode) {
                updates['resilience.mode'] = DEFAULT_RESILIENCE_CONFIG.mode;
                updates['resilience.forceMode'] = DEFAULT_RESILIENCE_CONFIG.forceMode;
                needsUpdate = true;
            }

            // 2. Validar Enabled (Si no existe, lo activamos por defecto si estamos migrando)
            if (currentRes.enabled === undefined) {
                updates['resilience.enabled'] = false; // Por seguridad inicia en false si no tenía nada
                needsUpdate = true;
            }

            // 3. Validar Triggers
            if (!currentRes.triggers || !currentRes.triggers.maxEventLoopLag) {
                updates['resilience.triggers'] = {
                    ...DEFAULT_RESILIENCE_CONFIG.triggers,
                    ...(currentRes.triggers || {}) // Mantener existentes si hubiera parciales
                };
                needsUpdate = true;
            }

            // 4. Validar Weights
            if (!currentRes.weights || !currentRes.weights.trust) {
                updates['resilience.weights'] = {
                    ...DEFAULT_RESILIENCE_CONFIG.weights,
                    ...(currentRes.weights || {})
                };
                needsUpdate = true;
            }

            if (needsUpdate) {
                // USAMOS UPDATEONE DIRECTO (Bypassing Mongoose Schema Validation)
                // Esto asegura que los campos se escriban aunque Client.js no tenga el Schema actualizado.
                await Client.collection.updateOne(
                    { _id: client._id },
                    { $set: updates }
                );
                process.stdout.write('✅');
                updatedCount++;
            } else {
                process.stdout.write('.');
            }
        }

        console.log(`\n\n✨ Migración Forzada Completa.`);
        console.log(`📝 Se parcharon ${updatedCount} clientes directamente en la colección.`);
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Error:', error);
        process.exit(1);
    }
};

migrate();