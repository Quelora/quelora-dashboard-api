/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// seedPlacements.js
require('dotenv').config({ path: '../.env' });
const { mongoose } = require('@quelora/common/db');
const Placement = require('../models/Placement');
const connectDB = require('../db');

// Obtenemos la fecha actual para todos los registros
const now = new Date();

const placementsData = [
  {
    _id: new mongoose.Types.ObjectId("692151fca6d1cc656544152e"),
    name: "Live Stream Overlay",
    key: "thread-overlay-live",
    width: 500,
    height: 930,
    device: "all",
    renderType: "display",
    pricingModel: "hybrid",
    floorPriceCPM: 3,
    floorPriceCPC: 0.6,
    floorPrice: 0.01,
    geoPricing: []
  },
  {
    _id: new mongoose.Types.ObjectId("692151fca6d1cc6565441530"),
    name: "Thread Overlay",
    key: "thread-overlay",
    width: 500,
    height: 930,
    device: "all",
    renderType: "display",
    pricingModel: "hybrid",
    floorPriceCPM: 1.5,
    floorPriceCPC: 0.3,
    floorPrice: 0.01,
    geoPricing: []
  },
  {
    _id: new mongoose.Types.ObjectId("692151fca6d1cc6565441531"),
    name: "Comment in feed",
    key: "comment-in-feed",
    width: 748,
    height: 60,
    device: "all",
    renderType: "native",
    pricingModel: "hybrid",
    floorPriceCPM: 1.2,
    floorPriceCPC: 0.25,
    floorPrice: 0.01,
    geoPricing: []
  },
  {
    _id: new mongoose.Types.ObjectId("692151fca6d1cc6565441532"),
    name: "Comment top feed",
    key: "comment-sponsored-top",
    width: 748,
    height: 60,
    device: "all",
    renderType: "native",
    pricingModel: "hybrid",
    floorPriceCPM: 1.8,
    floorPriceCPC: 0.4,
    floorPrice: 0.01,
    geoPricing: []
  },
  {
    _id: new mongoose.Types.ObjectId("692151fca6d1cc6565441533"),
    name: "Search Result Banner",
    key: "srch-ban",
    width: 748,
    height: 60,
    device: "all",
    renderType: "display",
    pricingModel: "hybrid",
    floorPriceCPM: 1,
    floorPriceCPC: 0.4,
    floorPrice: 0.01,
    geoPricing: []
  },
  {
    _id: new mongoose.Types.ObjectId("692151fca6d1cc6565441534"),
    name: "Sponsored Result",
    key: "srch-nat",
    width: 748,
    height: 60,
    device: "all",
    renderType: "native",
    pricingModel: "hybrid",
    floorPriceCPM: 0.9,
    floorPriceCPC: 0.35,
    floorPrice: 0.01,
    geoPricing: []
  },
  {
    _id: new mongoose.Types.ObjectId("692151fca6d1cc6565441535"),
    name: "In-Stream Midroll",
    key: "feed-mid-ban",
    width: 748,
    height: 60,
    device: "all",
    renderType: "display",
    pricingModel: "hybrid",
    floorPriceCPM: 0.6,
    floorPriceCPC: 0.1,
    floorPrice: 0.01,
    geoPricing: []
  },
  {
    _id: new mongoose.Types.ObjectId("692151fca6d1cc6565441536"),
    name: "Sponsored Reply",
    key: "feed-mid-nat",
    width: 748,
    height: 60,
    device: "all",
    renderType: "native",
    pricingModel: "hybrid",
    floorPriceCPM: 0.5,
    floorPriceCPC: 0.15,
    floorPrice: 0.01,
    geoPricing: []
  },
  {
    _id: new mongoose.Types.ObjectId("692151fca6d1cc6565441537"),
    name: "Footer Sticky Anchor",
    key: "foot-anc",
    width: 748,
    height: 60,
    device: "all",
    renderType: "display",
    pricingModel: "hybrid",
    floorPriceCPM: 0.7,
    floorPriceCPC: 0.12,
    floorPrice: 0.01,
    geoPricing: []
  }
];

async function seedPlacements() {
  try {
    await connectDB();
    console.log('🔄 Conectado a la DB...');

    for (const data of placementsData) {
      // Agregamos las fechas del momento a cada objeto antes de guardarlo
      const finalData = {
        ...data,
        createdAt: now,
        updatedAt: now
      };

      const existing = await Placement.findOne({ 
        $or: [{ _id: data._id }, { key: data.key }] 
      }).setOptions({ loadClients: false });

      if (existing) {
        console.log(`⚠️  "${data.key}" ya existe. Saltando...`);
        continue;
      }

      const placement = new Placement(finalData);
      await placement.save();
      console.log(`✅ Insertado: ${data.name}`);
    }

    console.log('\n🚀 ¡Todo listo! Seeding completado.');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    mongoose.connection.close();
  }
}

seedPlacements();