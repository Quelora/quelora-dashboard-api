/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// quelora-dashboard-api/seed/backfillProfileFields.js
require('dotenv').config();
const { mongoose } = require('@quelora/common/db');
const Profile = require('@quelora/common/models/Profile');
const connectDB = require('@quelora/common/db');

const backfill = async () => {
    await connectDB();

    console.log('🚀 Iniciando Backfill de Perfiles...');

    // 1. Inicializar isDeleted e isVerified en false si no existen
    const updateFlags = await Profile.updateMany(
        { 
            $or: [
                { isDeleted: { $exists: false } }, 
                { isVerified: { $exists: false } },
                { isBanned: { $exists: false } }
            ] 
        },
        { 
            $set: { 
                isDeleted: false, 
                isVerified: false,
                isBanned: false // Aseguramos que este exista también
            } 
        }
    );
    console.log(`✅ Flags actualizados: ${updateFlags.modifiedCount} perfiles.`);

    // 2. Inicializar lastActivityDate
    // Estrategia: Si no tiene fecha, usamos 'updated_at' o 'created_at' como fallback.
    // Si queremos probar el algoritmo YA, forzamos la fecha a "HOY" para un grupo de usuarios.
    
    // Opción A: Revivir a todos (ponerles fecha de hoy) para que el algoritmo los detecte
    const updateActivity = await Profile.updateMany(
        { lastActivityDate: { $exists: false } },
        { $set: { lastActivityDate: new Date() } } // Los marcamos como activos HOY
    );
    
    console.log(`✅ Actividad actualizada: ${updateActivity.modifiedCount} perfiles.`);

    console.log('🎉 Migración completada.');
    process.exit(0);
};

backfill().catch(err => {
    console.error(err);
    process.exit(1);
});