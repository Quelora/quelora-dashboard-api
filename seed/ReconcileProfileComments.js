/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ReconcileProfileComments.js
// USO: node ReconcileProfileComments.js

require('dotenv').config({ path: '../.env' });
const { mongoose } = require('@quelora/common/db');
const connectDB = require('@quelora/common/db');

// Asegúrate de que las rutas a tus modelos son correctas
const Profile = require('@quelora/common/models/Profile');
const ProfileComment = require('@quelora/common/models/ProfileComment');

// --- Configuración ---
const BATCH_SIZE = 1000; // Número de perfiles a procesar por lote
const TIMEOUT_MS = 60000; // 60 segundos de timeout para operaciones largas

/**
 * Conecta la base de datos y ejecuta el proceso de conciliación.
 */
async function reconcileProfileComments() {
    console.log('🚀 Iniciando proceso de conciliación de contadores de comentarios...');
    const startTime = Date.now();
    let totalProfilesProcessed = 0;
    let totalProfilesUpdated = 0;

    try {
        await connectDB();
        console.log('✅ Conexión a la base de datos establecida.');

        // Aplicamos maxTimeMS directamente al countDocuments (funciona)
        const totalProfiles = await Profile.countDocuments().maxTimeMS(TIMEOUT_MS); 
        console.log(`📊 Total de perfiles encontrados en el sistema: ${totalProfiles}`);
        
        let skip = 0;
        let batchCount = 0;

        while (skip < totalProfiles) {
            batchCount++;
            console.log(`\n--- Procesando lote #${batchCount} (Saltando ${skip}, Tamaño ${BATCH_SIZE}) ---`);
            
            // 1. Obtener un lote de perfiles (maxTimeMS aplicado directamente)
            const profiles = await Profile.find({}, '_id author commentsCount')
                .sort({ _id: 1 })
                .skip(skip)
                .limit(BATCH_SIZE)
                .lean()
                .maxTimeMS(TIMEOUT_MS);

            if (profiles.length === 0) {
                break;
            }

            const bulkOps = [];
            
            const profileIds = profiles.map(p => p._id);

            // 2. OBTENER LOS CONTEOS REALES (¡CORRECCIÓN APLICADA AQUÍ!)
            const realCounts = await ProfileComment.aggregate([
                { $match: { profile_id: { $in: profileIds } } },
                { $group: { _id: "$profile_id", count: { $sum: 1 } } }
            ], { maxTimeMS: TIMEOUT_MS }); // <--- CORRECCIÓN CLAVE
            // --------------------------------------------------------

            const realCountsMap = new Map(realCounts.map(item => [item._id.toString(), item.count]));

            // 3. Comparar y preparar operaciones de actualización en lote
            for (const profile of profiles) {
                const realCount = realCountsMap.get(profile._id.toString()) || 0;
                const currentCount = profile.commentsCount || 0;
                
                totalProfilesProcessed++;

                if (currentCount !== realCount) {
                    console.log(`   🔄 Perfil ${profile._id}: ${currentCount} -> ${realCount} (Diferencia: ${realCount - currentCount})`);
                    
                    bulkOps.push({
                        updateOne: {
                            filter: { _id: profile._id },
                            update: { 
                                $set: { 
                                    commentsCount: realCount, 
                                    updated_at: new Date() 
                                } 
                            }
                        }
                    });
                    totalProfilesUpdated++;
                }
            }

            // 4. Ejecutar la actualización en lote
            if (bulkOps.length > 0) {
                await Profile.bulkWrite(bulkOps);
                console.log(`   💾 Lote #${batchCount} actualizado: ${bulkOps.length} perfiles modificados.`);
            } else {
                console.log(`   🎉 Lote #${batchCount}: Todos los perfiles estaban sincronizados.`);
            }

            skip += profiles.length;

            // Pequeña pausa para evitar sobrecarga (opcional, pero recomendada)
            await new Promise(resolve => setTimeout(resolve, 500)); 
        }

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;

        console.log(`\n=================================================`);
        console.log(`🎉 CONCILIACIÓN FINALIZADA`);
        console.log(`=================================================`);
        console.log(`Procesados: ${totalProfilesProcessed} perfiles`);
        console.log(`Actualizados: ${totalProfilesUpdated} perfiles`);
        console.log(`Tiempo total: ${duration.toFixed(2)} segundos`);

    } catch (error) {
        console.error('❌ ERROR FATAL DURANTE LA CONCILIACIÓN:', error.message);
        return 1;
    } finally {
        await mongoose.connection.close();
        console.log('✅ Conexión a DB cerrada.');
        process.exit(0);
    }
}

reconcileProfileComments();