/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('@quelora/common/db');
require('dotenv').config();

// --- 1. Definición del Loader ---
const loadOptionalModule = (moduleName) => {
    try {
        return require(moduleName);
    } catch (error) {
        try {
            // Ajustar rutas relativas para alcanzar los paquetes hermanos desde la carpeta seed
            if (moduleName === '@quelora/enterprise') return require('../../quelora-enterprise/index');
            if (moduleName === '@quelora/common') return require('../../quelora-common');
        } catch (e) {
            console.error(`Failed to load module ${moduleName}:`, e.message);
            return null;
        }
        return null;
    }
};

// --- 2. Obtención del Servicio de Resiliencia ---
const getResilienceService = () => {
    // Intentamos cargar desde el index de enterprise primero
    const Enterprise = loadOptionalModule('@quelora/enterprise');
    
    // Si no está expuesto en el index, intentamos requerirlo directamente
    // Nota: resilienceService no estaba en tu index.js original, así que asumimos ruta directa
    // si Enterprise.resilienceService es undefined.
    if (Enterprise && Enterprise.resilienceService) {
        return Enterprise.resilienceService;
    }

    try {
        return require('../../quelora-enterprise/services/resilienceService');
    } catch (e) {
        console.error("Could not require resilienceService directly:", e.message);
        return null;
    }
};

const seedResilienceKeys = async () => {
    const resilienceService = getResilienceService();

    if (!resilienceService) {
        console.error('❌ Error: Could not load Resilience Service. Check paths and exports.');
        process.exit(1);
    }

    // Obtener CID de argumentos de línea de comando o usar default
    const args = process.argv.slice(2);
    const targetCid = args[0] || 'QU-ME7MZ3WI-3CUPR'; 

    const dbUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/quelora';

    try {
        await mongoose.connect(dbUri);
        console.log('🔌 Connected to MongoDB');

        console.log(`🔐 Seeding Resilience Keys for CID: ${targetCid}`);
        console.log('   Algorithm: Ed25519');

        // Esta función (que definimos en el paso anterior) hace todo el trabajo sucio:
        // 1. Genera par de claves
        // 2. Cifra la privada con cipher.js
        // 3. Actualiza el documento Client
        // 4. Limpia la caché
        const result = await resilienceService.generateAndStoreKeys(targetCid);

        if (result) {
            console.log('✅ Keys generated and stored successfully!');
            console.log(`   Key ID: ${result.keyId}`);
            console.log(`   Public Key Preview: ${result.publicKey.split('\n')[1]}...`); // Mostrar un pedazo seguro
        } else {
            console.error('❌ Failed to generate keys. Client might not exist.');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding resilience keys:', error);
        process.exit(1);
    }
};

seedResilienceKeys();