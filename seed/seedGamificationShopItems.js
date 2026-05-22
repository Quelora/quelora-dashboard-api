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
            console.warn(`⚠️ Warning: Could not load module ${moduleName}`);
            return null;
        }
        return null;
    }
};

// --- 2. Obtención de Modelos ---
const getGamificationModels = () => {
    const Enterprise = loadOptionalModule('@quelora/enterprise');
    const Common = loadOptionalModule('@quelora/common');

    const GamificationShopItem = 
        Enterprise?.GamificationShopItem || 
        Common?.GamificationShopItem || 
        Common?.models?.GamificationShopItem ||
        require('./models/GamificationShopItem'); // Fallback directo a archivo

    return { GamificationShopItem };
};

// --- 3. Script de Semilla ---
const seedShopItems = async () => {
    const { GamificationShopItem } = getGamificationModels();

    if (!GamificationShopItem) {
        console.error('❌ Error: Could not load Gamification Models. Check your module exports.');
        process.exit(1);
    }

    const dbUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/quelora';

    try {
        await mongoose.connect(dbUri);
        console.log('🔌 Connected to MongoDB');

        // TU CID OBJETIVO
        const targetCid = 'QU-ME7MZ3WI-3CUPR'; 

        const defaultItems = [
            // --- UTILITY ---
            {
                name: "Locuaz (+50 Caracteres)",
                description: "Expande tu límite de caracteres en comentarios y publicaciones por 50 adicionales.",
                priceCoins: 500,
                type: "PERMANENT",
                effectType: "CHAR_LIMIT_INCREASE",
                metadata: { value: 50 },
                category: "UTILITY",
                order: 1
            },
            {
                name: "Congelador de Racha",
                description: "Protege tu racha de días consecutivos si olvidas conectarte un día. Se consume automáticamente.",
                priceCoins: 300,
                type: "CONSUMABLE",
                effectType: "STREAK_FREEZE",
                metadata: { value: 1 },
                category: "UTILITY",
                order: 2
            },
            {
                name: "Modo Fantasma (24h)",
                description: "Navega sin dejar rastro de 'Visto' o 'En Línea' durante 24 horas.",
                priceCoins: 150,
                type: "CONSUMABLE",
                effectType: "GHOST_MODE",
                metadata: { value: 24 }, // Horas
                category: "UTILITY",
                order: 3
            },

            // --- COSMETIC ---
            {
                name: "Nombre Dorado",
                description: "Tu nombre de usuario aparecerá en color dorado brillante.",
                priceCoins: 2000,
                type: "PERMANENT",
                effectType: "NICKNAME_COLOR",
                metadata: { value: "#FFD700" },
                category: "COSMETIC",
                order: 4
            },
            {
                name: "Nombre Neón Azul",
                description: "Tu nombre de usuario brillará con un tono azul neón.",
                priceCoins: 2000,
                type: "PERMANENT",
                effectType: "NICKNAME_COLOR",
                metadata: { value: "#00FFFF" },
                category: "COSMETIC",
                order: 5
            },
            {
                name: "Marco de Perfil: Fuego",
                description: "Un marco animado de fuego para tu avatar.",
                priceCoins: 5000,
                type: "PERMANENT",
                effectType: "PROFILE_FRAME",
                metadata: { assetUrl: "/assets/frames/fire_frame.png" }, // Placeholder URL
                category: "COSMETIC",
                order: 6
            },

            // --- SOCIAL ---
            {
                name: "Boost de Publicación (1h)",
                description: "Destaca tu publicación en el feed de tendencias durante 1 hora.",
                priceCoins: 1000,
                type: "CONSUMABLE",
                effectType: "POST_BOOST",
                metadata: { value: 1 }, // Horas
                category: "SOCIAL",
                order: 7
            },
            {
                name: "Desbloquear GIFs",
                description: "Habilita la opción de insertar GIFs animados en tus comentarios.",
                priceCoins: 1500,
                type: "PERMANENT",
                effectType: "UNLOCK_MEDIA_GIF",
                metadata: { value: true },
                category: "SOCIAL",
                order: 8
            }
        ];

        console.log(`Processing CID: ${targetCid}`);

        for (const itemDef of defaultItems) {
            await GamificationShopItem.findOneAndUpdate(
                { cid: targetCid, name: itemDef.name }, // Clave única compuesta por CID + Nombre para evitar duplicados en seed
                { 
                    description: itemDef.description,
                    priceCoins: itemDef.priceCoins,
                    type: itemDef.type,
                    effectType: itemDef.effectType,
                    metadata: itemDef.metadata,
                    category: itemDef.category,
                    order: itemDef.order,
                    active: true 
                },
                { upsert: true, new: true }
            );
            console.log(`   -> Item upserted: ${itemDef.name} (${itemDef.priceCoins} Coins)`);
        }
        
        console.log('✅ Gamification Shop Items seeded successfully!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error seeding shop items:', error);
        process.exit(1);
    }
};

seedShopItems();