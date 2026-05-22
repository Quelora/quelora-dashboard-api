/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('@quelora/common/db');
require('dotenv').config();

// --- 1. Definición del Loader (Simulación para script standalone) ---
// Si tienes este helper en un path común (ej: @quelora/common/utils), impórtalo desde ahí.
// Aquí lo defino localmente para garantizar que el script corra sin dependencias externas ocultas.
const loadOptionalModule = (moduleName) => {
    try {
        return require(moduleName);
    } catch (error) {
        // Fallback: Si no encuentra el paquete compilado, intenta buscar en local si estás en desarrollo
        // Esto es útil si corres el seed dentro de la misma carpeta del proyecto sin compilar
        try {
            if (moduleName === '@quelora/enterprise') return require('./index'); // O la ruta a tus exports
            if (moduleName === '@quelora/common') return require('../common'); 
        } catch (e) {
            console.warn(`⚠️ Warning: Could not load module ${moduleName}`);
            return null;
        }
        return null;
    }
};

// --- 2. Obtención de Modelos con tu Patrón ---
const getGamificationModels = () => {
    // Cargamos el módulo Enterprise (o Common si ahí residen las reglas base)
    const Enterprise = loadOptionalModule('@quelora/enterprise');
    const Common = loadOptionalModule('@quelora/common');

    // Buscamos los modelos en Enterprise primero, luego Common, o fallbacks locales
    // Ajusta la prioridad según tu estructura de exports real.
    const GamificationRule = 
        Enterprise?.GamificationRule || 
        Common?.GamificationRule || 
        Common?.models?.GamificationRule ||
        require('./models/GamificationRule'); // Fallback directo a archivo

    const GamificationConfig = 
        Enterprise?.GamificationConfig || 
        Common?.GamificationConfig || 
        Common?.models?.GamificationConfig ||
        require('./models/GamificationConfig'); // Fallback directo a archivo

    return { GamificationRule, GamificationConfig };
};

// --- 3. Script de Semilla ---
const seedRules = async () => {
    const { GamificationRule, GamificationConfig } = getGamificationModels();

    if (!GamificationRule || !GamificationConfig) {
        console.error('❌ Error: Could not load Gamification Models. Check your module exports.');
        process.exit(1);
    }

    const dbUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/quelora';

    try {
        await mongoose.connect(dbUri);
        console.log('🔌 Connected to MongoDB');

        // TU CID OBJETIVO
        const targetCid = 'QU-ME7MZ3WI-3CUPR'; 

        // Definición de Reglas Balanceadas para Nivel 1 = 100k XP
        const defaultRules = [
            // --- CORE CONVERSATION (High Frequency, Medium XP) ---
            { 
                actionType: 'COMMENT_CREATED', 
                xpReward: 150,      // 10 comments = 1500 XP
                coinReward: 2,      // 10 comments = 20 Coins
                dailyLimit: 20 
            },
            { 
                actionType: 'REPLY_CREATED', 
                xpReward: 100,      // Slightly less than commenting
                coinReward: 1, 
                dailyLimit: 30 
            },
            { 
                actionType: 'POST_CREATED', 
                xpReward: 500,      // High XP reward for content generation
                coinReward: 10,     
                dailyLimit: 5 
            },

            // --- SOCIAL ENGAGEMENT (Low Frequency per user, Low XP) ---
            { 
                actionType: 'LIKE_RECEIVED', 
                xpReward: 50,       // Passive XP income from quality content
                coinReward: 0,      // No coins for passive likes (prevents inflation)
                dailyLimit: 0       // Unlimited
            },
            { 
                actionType: 'LIKE_GIVEN', 
                xpReward: 10,       // Small incentive to interact
                coinReward: 0, 
                dailyLimit: 50 
            },
            { 
                actionType: 'POST_SHARED', 
                xpReward: 300,      // High value for virality
                coinReward: 5, 
                dailyLimit: 5 
            },
            { 
                actionType: 'USER_MENTIONED', 
                xpReward: 20, 
                coinReward: 0, 
                dailyLimit: 10 
            },

            // --- RETENTION & STICKINESS (High Value) ---
            { 
                actionType: 'DAILY_LOGIN', 
                xpReward: 200,      // Base daily reward
                coinReward: 5, 
                dailyLimit: 1 
            },
            { 
                actionType: 'STREAK_BONUS', 
                xpReward: 2500,     // Huge bonus for weekly consistency
                coinReward: 50, 
                dailyLimit: 1 
            },
            { 
                actionType: 'PROFILE_COMPLETED', 
                xpReward: 5000,     // One-time boost
                coinReward: 100, 
                dailyLimit: 1 
            },
            { 
                actionType: 'ACCOUNT_VERIFIED', 
                xpReward: 10000,    // Major trust milestone (10% of Level 1)
                coinReward: 250, 
                dailyLimit: 1 
            },

            // --- QUALITY & MODERATION ---
            { 
                actionType: 'POST_FEATURED', 
                xpReward: 5000,     // Editors choice
                coinReward: 100, 
                dailyLimit: 0 
            },
            { 
                actionType: 'REPORT_APPROVED', 
                xpReward: 250,      // Community cleaning
                coinReward: 5, 
                dailyLimit: 0 
            },

            // --- MODULES & EXTRAS ---
            { 
                actionType: 'SURVEY_VOTED', 
                xpReward: 100, 
                coinReward: 1, 
                dailyLimit: 10 
            },
            { 
                actionType: 'QUEST_COMPLETED', 
                xpReward: 2000,     // Module specific missions
                coinReward: 50, 
                dailyLimit: 0 
            },
            { 
                actionType: 'VIDEO_WATCHED', 
                xpReward: 50, 
                coinReward: 1, 
                dailyLimit: 20 
            },
            { 
                actionType: 'MEDIA_UPLOADED', 
                xpReward: 200, 
                coinReward: 2, 
                dailyLimit: 10 
            }
        ];

        console.log(`Processing CID: ${targetCid}`);

        // 1. Configuración General
        await GamificationConfig.findOneAndUpdate(
            { cid: targetCid },
            { 
                enabled: true, 
                currency: { name: 'Gambetas', symbol: '⚽', singularName: 'Gambeta' },
                resetStrategy: 'NEVER'
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        console.log('✅ Gamification Config configured');

        // 2. Crear o Actualizar Reglas
        for (const ruleDef of defaultRules) {
            await GamificationRule.findOneAndUpdate(
                { cid: targetCid, actionType: ruleDef.actionType },
                { 
                    xpReward: ruleDef.xpReward,
                    coinReward: ruleDef.coinReward,
                    dailyLimit: ruleDef.dailyLimit,
                    active: true 
                },
                { upsert: true, new: true }
            );
            console.log(`   -> Rule upserted: ${ruleDef.actionType} (XP: ${ruleDef.xpReward} | Coins: ${ruleDef.coinReward})`);
        }
        
        console.log('✅ Gamification Rules seeded successfully!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error seeding rules:', error);
        process.exit(1);
    }
};

seedRules();