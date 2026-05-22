/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-dashboard-api/seed/seedReputationLogs.js */
const { mongoose } = require('@quelora/common/db');
require('dotenv').config();

// --- 1. Definición del Loader (Mismo patrón que tu archivo de referencia) ---
const loadOptionalModule = (moduleName) => {
    try {
        return require(moduleName);
    } catch (error) {
        try {
            if (moduleName === '@quelora/common') return require('../../quelora-common');
            if (moduleName === '@quelora/common/models/Profile') return require('../../quelora-common/models/Profile');
            if (moduleName === '@quelora/common/models/ReputationLog') return require('../../quelora-common/models/ReputationLog');
        } catch (e) {
            return null;
        }
        return null;
    }
};

// --- 2. Model Loading ---
const getModels = () => {
    const Common = loadOptionalModule('@quelora/common');
    return {
        Profile: Common?.Profile || loadOptionalModule('@quelora/common/models/Profile'),
        ReputationLog: Common?.ReputationLog || loadOptionalModule('@quelora/common/models/ReputationLog')
    };
};

// --- 3. Configuración de Distribución ---
const EVENT_TYPES = [
    { type: 'upvote', weight: 1, chance: 0.7 },        // Muy frecuente
    { type: 'helpful_mark', weight: 15, chance: 0.15 }, // Poco frecuente
    { type: 'correction', weight: 30, chance: 0.1 },    // Raro
    { type: 'pinned', weight: 60, chance: 0.05 }        // Muy raro
];

// Niveles de usuarios (Distribución de Pareto)
const USER_TIERS = [
    { label: 'lurker', probability: 0.60, minEvents: 0, maxEvents: 2 },      // 60% usuarios (casi nula actividad)
    { label: 'casual', probability: 0.30, minEvents: 5, maxEvents: 20 },     // 30% usuarios
    { label: 'active', probability: 0.09, minEvents: 30, maxEvents: 150 },   // 9% usuarios
    { label: 'legend', probability: 0.01, minEvents: 500, maxEvents: 1500 }  // 1% usuarios (Influencers)
];

// --- 4. Helpers ---
const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const getRandomEvent = () => {
    const r = Math.random();
    let accumulated = 0;
    for (const event of EVENT_TYPES) {
        accumulated += event.chance;
        if (r <= accumulated) return event;
    }
    return EVENT_TYPES[0];
};

const getTier = () => {
    const r = Math.random();
    let accumulated = 0;
    for (const tier of USER_TIERS) {
        accumulated += tier.probability;
        if (r <= accumulated) return tier;
    }
    return USER_TIERS[0];
};

const getRandomDate = (start, end) => {
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
};

// --- 5. Main Seeder ---
const seedReputation = async () => {
    const { Profile, ReputationLog } = getModels();

    if (!Profile || !ReputationLog) {
        console.error('❌ Error: Could not load required Models.');
        process.exit(1);
    }

    const dbUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/quelora';

    try {
        await mongoose.connect(dbUri);
        console.log('🔌 Connected to MongoDB');

        // Limpieza opcional: Descomentar si quieres resetear logs y scores antes
        // console.log('🧹 Cleaning old reputation logs...');
        // await ReputationLog.deleteMany({});
        // await Profile.updateMany({}, { 'trust.score': 0, 'trust.level': 0 });

        // Obtenemos solo los IDs para iterar eficientemente (Cursor)
        // Filtramos por CID si quieres atacar uno específico, o todos si se omite
        const cidFilter = {}; // { cid: 'QU-ME7MZ3WI-3CUPR' }; 
        const totalProfiles = await Profile.countDocuments(cidFilter);
        
        console.log(`🎯 Targeting ${totalProfiles} profiles for reputation seeding...`);

        const cursor = Profile.find(cidFilter).select('_id cid').cursor();
        
        const logsBatch = [];
        const profileUpdatesBatch = [];
        const BATCH_SIZE = 2000;
        let processedCount = 0;

        // Simulamos un pool de "Source IDs" (quienes dan los likes) para no consultar DB a cada rato
        // Tomamos una muestra aleatoria de 100 IDs para usarlos como "fuente" de los votos
        const sourceIds = await Profile.aggregate([{ $sample: { size: 100 } }, { $project: { _id: 1 } }]);
        const getRandomSource = () => sourceIds[getRandomInt(0, sourceIds.length - 1)]._id;

        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const now = new Date();

        for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
            const tier = getTier();
            const numEvents = getRandomInt(tier.minEvents, tier.maxEvents);
            
            // Si el usuario es "Lurker" y sale 0 eventos, saltamos
            if (numEvents === 0) {
                processedCount++;
                continue;
            }

            let totalScoreDelta = 0;

            for (let i = 0; i < numEvents; i++) {
                const eventConfig = getRandomEvent();
                const eventDate = getRandomDate(sixMonthsAgo, now);
                
                logsBatch.push({
                    target_profile_id: doc._id,
                    source_profile_id: getRandomSource(),
                    event_type: eventConfig.type,
                    delta: eventConfig.weight,
                    trust_level_snapshot: getRandomInt(1, 5), // Nivel simulado del votante
                    created_at: eventDate
                });

                totalScoreDelta += eventConfig.weight;
            }

            // Calculamos el nivel basado en el score acumulado (Simplificado para el seed)
            // Lógica similar a reputationProcessorService
            let newLevel = 0;
            if (totalScoreDelta > 5000) newLevel = 5;
            else if (totalScoreDelta > 1000) newLevel = 4;
            else if (totalScoreDelta > 200) newLevel = 3;
            else if (totalScoreDelta > 50) newLevel = 2;
            else if (totalScoreDelta > 0) newLevel = 1;

            profileUpdatesBatch.push({
                updateOne: {
                    filter: { _id: doc._id },
                    update: { 
                        $set: { 
                            'trust.score': totalScoreDelta,
                            'trust.level': newLevel,
                            'trust.last_calc': new Date()
                        } 
                    }
                }
            });

            // Flush de Lotes
            if (logsBatch.length >= BATCH_SIZE) {
                await ReputationLog.insertMany(logsBatch);
                logsBatch.length = 0;
            }

            if (profileUpdatesBatch.length >= BATCH_SIZE) {
                await Profile.bulkWrite(profileUpdatesBatch);
                profileUpdatesBatch.length = 0;
                process.stdout.write(`\r🚀 Processed ${processedCount} / ${totalProfiles} profiles...`);
            }

            processedCount++;
        }

        // Flush Final
        if (logsBatch.length > 0) {
            await ReputationLog.insertMany(logsBatch);
        }
        if (profileUpdatesBatch.length > 0) {
            await Profile.bulkWrite(profileUpdatesBatch);
        }

        console.log(`\n\n✅ Seeding Complete!`);
        console.log(`📊 Generated realistic reputation for ${processedCount} profiles.`);
        
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Fatal Error during seeding:', error);
        process.exit(1);
    }
};

seedReputation();