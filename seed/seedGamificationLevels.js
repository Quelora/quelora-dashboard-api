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
            if (moduleName === '@quelora/enterprise') return require('./index');
            if (moduleName === '@quelora/common') return require('../common'); 
        } catch (e) {
            return null;
        }
        return null;
    }
};

// --- 2. Obtención del Modelo ---
const getGamificationLevelModel = () => {
    const Enterprise = loadOptionalModule('@quelora/enterprise');
    const Common = loadOptionalModule('@quelora/common');

    return Enterprise?.GamificationLevel || 
           Common?.GamificationLevel || 
           Common?.models?.GamificationLevel ||
           require('./models/GamificationLevel');
};

const seedLevels = async () => {
    const GamificationLevel = getGamificationLevelModel();

    if (!GamificationLevel) {
        console.error('❌ Error: Could not load GamificationLevel Model.');
        process.exit(1);
    }

    const dbUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/quelora';

    try {
        await mongoose.connect(dbUri);
        console.log('🔌 Connected to MongoDB');

        const targetCid = 'QU-ME7MZ3WI-3CUPR'; 

        // Escalas ajustadas a tu imagen
        const levels = [
            { name: 'Novicio', minPoints: 0, order: 0 },
            { name: 'Seed', minPoints: 100000, order: 1 },
            { name: 'Thread Walker', minPoints: 250000, order: 2 },
            { name: 'Signal Raiser', minPoints: 500000, order: 3 },
            { name: 'Master', minPoints: 1000000, order: 4 },
            { name: 'Lore Keeper', minPoints: 3000000, order: 5 },
            { name: 'Oracle', minPoints: 6000000, order: 6 }
        ];

        console.log(`Seeding levels for CID: ${targetCid}`);

        for (const lvl of levels) {
            await GamificationLevel.findOneAndUpdate(
                { cid: targetCid, order: lvl.order },
                { 
                    name: lvl.name,
                    minPoints: lvl.minPoints,
                    description: `Level ${lvl.order}: ${lvl.name}`
                },
                { upsert: true, new: true }
            );
            console.log(`   -> Level upserted: [${lvl.order}] ${lvl.name} (${lvl.minPoints} XP)`);
        }

        console.log('✅ Gamification Levels seeded successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding levels:', error);
        process.exit(1);
    }
};

seedLevels();