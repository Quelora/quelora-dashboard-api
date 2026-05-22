/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-dashboard-api/seed/seedReputationConfigs.js */
const { mongoose } = require('@quelora/common/db');
require('dotenv').config();

// --- 1. Definición del Loader ---
const loadOptionalModule = (moduleName) => {
    try {
        return require(moduleName);
    } catch (error) {
        try {
            if (moduleName === '@quelora/common') return require('../../quelora-common');
            // Fallback específico para modelos directos si el index no exporta todo
            if (moduleName === '@quelora/common/models/ReputationConfig') return require('../../quelora-common/models/ReputationConfig');
        } catch (e) {
            return null;
        }
        return null;
    }
};

// --- 2. Obtención del Modelo ---
const getReputationConfigModel = () => {
    const Common = loadOptionalModule('@quelora/common');
    
    // Intentar obtener desde el paquete Common exportado, o buscar directamente el archivo
    return Common?.ReputationConfig || 
           Common?.models?.ReputationConfig || 
           loadOptionalModule('@quelora/common/models/ReputationConfig');
};

const seedConfigs = async () => {
    const ReputationConfig = getReputationConfigModel();

    if (!ReputationConfig) {
        console.error('❌ Error: Could not load ReputationConfig Model.');
        process.exit(1);
    }

    const dbUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/quelora';

    try {
        await mongoose.connect(dbUri);
        console.log('🔌 Connected to MongoDB');

        const configs = [
            {
                cid: 'default',
                weights: {
                    helpful_mark: 10,
                    pinned: 50,
                    correction: 20,
                    good_reporter: 10,
                    bad_reporter: -2,
                    upvote: 1,
                    downvote: -2,
                    survey_vote: 2,
                    spam_report: -50,
                    mod_removal: -100
                },
                trust_levels: [
                    { lvl: 0, min: -Infinity, label: "Newbie" },
                    { lvl: 1, min: 0, label: "User" },
                    { lvl: 2, min: 50, label: "Trusted" },
                    { lvl: 3, min: 200, label: "Expert" },
                    { lvl: 4, min: 1000, label: "Guru" },
                    { lvl: 5, min: 5000, label: "Legend" }
                ],
                limits: {
                    max_daily_reputation_gain: 100,
                    decay_rate: 0.05
                }
            },
            {
                cid: 'QU-ME7MZ3WI-3CUPR', 
                weights: {
                    helpful_mark: 15, 
                    pinned: 60,
                    correction: 30, 
                    upvote: 2,
                    downvote: -5, 
                    spam_report: -50,
                    mod_removal: -100
                },
                trust_levels: [
                    { lvl: 0, min: -Infinity, label: "Novice" },
                    { lvl: 1, min: 10, label: "Member" },
                    { lvl: 2, min: 100, label: "Contributor" },
                    { lvl: 3, min: 500, label: "Engineer" },
                    { lvl: 4, min: 2000, label: "Architect" },
                    { lvl: 5, min: 10000, label: "Fellow" }
                ],
                limits: {
                    max_daily_reputation_gain: 200,
                    decay_rate: 0.02
                }
            }
        ];

        console.log('Seeding Reputation Configs...');

        for (const config of configs) {
            await ReputationConfig.findOneAndUpdate(
                { cid: config.cid },
                { $set: config },
                { upsert: true, new: true }
            );
            console.log(`   -> Config upserted for CID: ${config.cid}`);
        }

        console.log('✅ Reputation Configs seeded successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding configs:', error);
        process.exit(1);
    }
};

seedConfigs();