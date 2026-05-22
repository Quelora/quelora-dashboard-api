/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// SeedPostsLikes.js - Script único para generar likes en posts existentes (MÁX 1000)
// USO: node SeedPostsLikes.js

require('dotenv').config({ path: '../.env' });
const { mongoose } = require('@quelora/common/db');
const connectDB = require('../db');
const Post = require('../models/Post');
const Profile = require('../models/Profile');
const ProfileLike = require('../models/ProfileLike');

const TIMEOUT_MS = 30000;
const MAX_LIKES_PER_POST = 1000; // MÁXIMO de likes por post

/**
 * Simula likes para un post usando perfiles existentes (MÁXIMO 1000)
 */
async function simulatePostLikes(post, allProfileIds) {
    const likesCount = post.likesCount || 0;
    
    if (likesCount <= 0 || allProfileIds.length === 0) {
        console.log(`   ⏩ Post ${post._id} sin likesCount o sin perfiles disponibles`);
        return { success: false, reason: 'no_likes_or_profiles' };
    }

    try {
        // ELIMINAR likes existentes en ProfileLike para este post
        const deleteResult = await ProfileLike.deleteMany({ 
            fk_id: post._id, 
            fk_type: 'post' 
        });
        
        if (deleteResult.deletedCount > 0) {
            console.log(`   🗑️  Eliminados ${deleteResult.deletedCount} ProfileLike existentes para el post ${post._id}`);
        }

        // LIMPIAR el array de likes del post
        await Post.findByIdAndUpdate(post._id, {
            $set: { likes: [] }
        });
        console.log(`   🧹 Array de likes limpiado para el post ${post._id}`);

        // Mapeamos los IDs de MongoDB a sus autores (hashes) para los likers
        const profileIdToAuthorMap = new Map(allProfileIds.map(p => [p._id.toString(), p.author]));
        
        // Filtrar perfiles que no sean el autor original del post (si existe)
        const likerPool = allProfileIds.filter(profile => {
            return profile.author !== post.author;
        });

        if (likerPool.length === 0) {
            console.log(`   ⚠️  No hay perfiles disponibles para likear el post ${post._id}`);
            return { success: false, reason: 'no_available_profiles' };
        }

        const shuffledLikerPool = [...likerPool].sort(() => 0.5 - Math.random());
        
        // CALCULAR número de likes a crear (MÁXIMO 1000)
        const numLikesToCreate = Math.min(
            Math.min(likesCount, shuffledLikerPool.length), // El menor entre likesCount y perfiles disponibles
            MAX_LIKES_PER_POST // Pero nunca más de 1000
        );
        
        const selectedLikers = shuffledLikerPool.slice(0, numLikesToCreate);
        
        console.log(`   🎯 Simulando ${numLikesToCreate} likes (de ${likesCount} posibles) para post "${post.title.substring(0, 50)}..."`);
        
        const profileLikeDocs = selectedLikers.map(liker => ({ 
            profile_id: liker._id, 
            fk_id: post._id, 
            fk_type: 'post',
            created_at: new Date()
        }));
        
        if (profileLikeDocs.length > 0) {
            // Insertar los ProfileLike documents
            await ProfileLike.insertMany(profileLikeDocs);
            console.log(`   ❤️  ${profileLikeDocs.length} ProfileLike creados para el post ${post._id}`);
            
            // OBTENEMOS EL CAMPO 'author' (HASH) para el array de likes
            const likerAuthors = selectedLikers.map(l => profileIdToAuthorMap.get(l._id.toString()) || l.author);
            
            // SE AÑADEN AL ARRAY DE LIKES DEL POST USANDO EL HASH DEL AUTOR (MÁXIMO 1000)
            await Post.findByIdAndUpdate(post._id, {
                $push: { 
                    likes: { 
                        $each: likerAuthors,
                        $slice: -MAX_LIKES_PER_POST // GARANTIZAR MÁXIMO 1000 ELEMENTOS
                    } 
                },
                $set: { updated_at: new Date() }
            });
            console.log(`   ✍️  Añadidos ${likerAuthors.length} autores (hashes) al array de likes del post.`);
            
            return { 
                success: true, 
                likesCreated: profileLikeDocs.length,
                likerAuthors: likerAuthors 
            };
        }
        
        return { success: false, reason: 'no_likes_created' };
    } catch (error) {
        console.error(`   ❌ Error simulando likes para post ${post._id}:`, error.message);
        return { success: false, reason: 'error', error: error.message };
    }
}

/**
 * Procesa un lote de posts para generar likes
 */
async function processPostsBatch(posts, allProfileIds, batchNumber, totalBatches) {
    console.log(`\n📦 Procesando lote ${batchNumber}/${totalBatches} (${posts.length} posts)...`);
    
    let successful = 0;
    let skipped = 0;
    let errors = 0;

    for (const post of posts) {
        try {
            const result = await simulatePostLikes(post, allProfileIds);
            
            if (result.success) {
                successful++;
                console.log(`   ✅ Post ${post._id}: ${result.likesCreated} likes creados`);
            } else {
                skipped++;
                
                // Log razones de salto
                if (result.reason === 'no_likes_or_profiles') {
                    console.log(`   ⏩ Saltado: sin likesCount o perfiles`);
                } else if (result.reason === 'no_available_profiles') {
                    console.log(`   ⏩ Saltado: sin perfiles disponibles`);
                } else if (result.reason === 'no_likes_created') {
                    console.log(`   ⏩ Saltado: no se crearon likes`);
                }
            }
            
            // Pequeña pausa para no saturar la base de datos
            await new Promise(resolve => setTimeout(resolve, 50));
            
        } catch (error) {
            console.error(`   ❌ Error procesando post ${post._id}:`, error.message);
            errors++;
        }
    }
    
    return { successful, skipped, errors };
}

/**
 * Función principal
 */
async function seedPostsLikes() {
    let exitCode = 0;
    try {
        console.log('🚀 Iniciando script de generación de likes para posts existentes...');
        console.log('📊 Este script se ejecutará UNA SOLA VEZ');
        console.log(`🎯 MÁXIMO ${MAX_LIKES_PER_POST} likes por post`);
        console.log('⚠️  ELIMINARÁ todos los likes existentes y creará nuevos');
        
        await connectDB();
        console.log('✅ Conectado a la base de datos');

        // Obtener todos los perfiles existentes para simulación de likes
        console.log('\n👤 Obteniendo perfiles existentes...');
        const allProfileIds = await Profile.find({}, '_id author').lean().maxTimeMS(TIMEOUT_MS);
        console.log(`✅ Encontrados ${allProfileIds.length} perfiles para usar como votantes`);

        // Obtener todos los posts que necesitan likes
        console.log('\n📝 Obteniendo posts de la base de datos...');
        const allPosts = await Post.find({})
            .select('_id title author likesCount likes')
            .lean()
            .maxTimeMS(TIMEOUT_MS);
        
        console.log(`✅ Encontrados ${allPosts.length} posts en total`);

        // Filtrar posts que tienen likesCount > 0
        const postsWithLikes = allPosts.filter(post => {
            return post.likesCount && post.likesCount > 0;
        });

        console.log(`📊 Posts con likesCount > 0: ${postsWithLikes.length}`);
        console.log(`📊 Posts sin likesCount: ${allPosts.length - postsWithLikes.length}`);

        if (postsWithLikes.length === 0) {
            console.log('ℹ️  No hay posts que necesiten likes. Saliendo...');
            return;
        }

        // Configuración de procesamiento por lotes
        const BATCH_SIZE = 10;
        const totalBatches = Math.ceil(postsWithLikes.length / BATCH_SIZE);
        
        console.log(`\n🔄 Procesando ${postsWithLikes.length} posts en ${totalBatches} lotes de ${BATCH_SIZE}...`);

        let totalSuccessful = 0;
        let totalSkipped = 0;
        let totalErrors = 0;

        // Procesar posts por lotes
        for (let i = 0; i < postsWithLikes.length; i += BATCH_SIZE) {
            const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
            const batch = postsWithLikes.slice(i, i + BATCH_SIZE);
            
            const batchResult = await processPostsBatch(batch, allProfileIds, batchNumber, totalBatches);
            
            totalSuccessful += batchResult.successful;
            totalSkipped += batchResult.skipped;
            totalErrors += batchResult.errors;

            console.log(`   📊 Lote ${batchNumber} completado: ${batchResult.successful} éxito, ${batchResult.skipped} saltados, ${batchResult.errors} errores`);

            // Pausa entre lotes para no saturar la base de datos
            if (batchNumber < totalBatches) {
                console.log('   ⏳ Esperando 2 segundos antes del siguiente lote...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Estadísticas finales
        console.log('\n🎉 PROCESO COMPLETADO - ESTADÍSTICAS FINALES:');
        console.log('=========================================');
        console.log(`📝 Total posts procesados: ${postsWithLikes.length}`);
        console.log(`✅ Posts con likes generados exitosamente: ${totalSuccessful}`);
        console.log(`⏩ Posts saltados: ${totalSkipped}`);
        console.log(`❌ Errores: ${totalErrors}`);
        console.log(`👤 Perfiles utilizados para likes: ${allProfileIds.length}`);
        console.log(`🎯 MÁXIMO de likes por post: ${MAX_LIKES_PER_POST}`);

        // Verificación final
        console.log('\n🔍 VERIFICACIÓN FINAL:');
        const totalProfileLikes = await ProfileLike.countDocuments({ fk_type: 'post' });
        console.log(`   Total ProfileLike documents (posts): ${totalProfileLikes}`);
        
        // Verificar que ningún post tiene más de 1000 likes
        const postsWithLikesCount = await Post.aggregate([
            {
                $project: {
                    title: 1,
                    likesCount: 1,
                    arrayLikesCount: { $size: { $ifNull: ["$likes", []] } }
                }
            },
            {
                $match: {
                    arrayLikesCount: { $gt: MAX_LIKES_PER_POST }
                }
            }
        ]);
        
        console.log(`   Posts con más de ${MAX_LIKES_PER_POST} likes en el array: ${postsWithLikesCount.length}`);
        
        if (postsWithLikesCount.length > 0) {
            console.log('   ❌ ERROR: Algunos posts tienen más del límite de likes:');
            postsWithLikesCount.forEach(post => {
                console.log(`      - "${post.title}" : ${post.arrayLikesCount} likes`);
            });
        } else {
            console.log(`   ✅ Todos los posts tienen ≤ ${MAX_LIKES_PER_POST} likes en el array`);
        }

    } catch (error) {
        console.error('❌ Error fatal en el script:', error.message, error.stack);
        exitCode = 1;
    } finally {
        await mongoose.connection.close();
        console.log('\n✅ Conexión a DB cerrada. Script finalizado.');
        process.exit(exitCode);
    }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
    console.log('⚠️  ADVERTENCIA: Este script ELIMINARÁ todos los likes existentes y creará nuevos.');
    console.log(`⚠️  Se crearán como MÁXIMO ${MAX_LIKES_PER_POST} likes por post.`);
    console.log('⚠️  Se ejecutará UNA SOLA VEZ y puede tomar tiempo dependiendo de la cantidad de posts.');
    console.log('⚠️  Presiona Ctrl+C en los próximos 5 segundos para cancelar...');
    
    setTimeout(() => {
        seedPostsLikes();
    }, 5000);
}

module.exports = { seedPostsLikes };