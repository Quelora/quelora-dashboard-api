/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// packages/quelora-dashboard-api/scripts/migrateClients.js
const { mongoose } = require('@quelora/common/db');
const Client = require('@quelora/common/models/Client');
require('dotenv').config();

async function migrate() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const db = mongoose.connection.db;
        const clientsCollection = db.collection('clients');
        const usersCollection = db.collection('users');

        try {
            await clientsCollection.drop();
            console.log('✅ Cleaned up previous clients collection.');
        } catch (error) {
            if (error.codeName !== 'NamespaceNotFound') {
                console.log('Note: Clients collection did not exist or could not be dropped, continuing...');
            }
        }

        await Client.syncIndexes();
        console.log('✅ New indexes created successfully (including users array).');

        const users = await usersCollection.find({ 'clients.0': { $exists: true } }).toArray();
        console.log(`Found ${users.length} users with embedded clients.`);

        for (const user of users) {
            if (!user.clients || !Array.isArray(user.clients)) continue;

            for (const embeddedClient of user.clients) {
                try {
                    await Client.create({
                        users: [user._id], // Initialize N:M array with the owner
                        cid: embeddedClient.cid,
                        description: embeddedClient.description,
                        apiUrl: embeddedClient.apiUrl,
                        config: embeddedClient.config,
                        postConfig: embeddedClient.postConfig,
                        vapid: embeddedClient.vapid,
                        email: embeddedClient.email,
                        createdAt: embeddedClient.createdAt || new Date(),
                        updatedAt: new Date()
                    });
                    console.log(`Migrated client ${embeddedClient.cid} for user ${user.username}`);
                } catch (e) {
                    console.error(`Failed to migrate client ${embeddedClient.cid}:`, e.message);
                }
            }
        }

        console.log('Migration complete.');
        process.exit(0);

    } catch (error) {
        console.error('Critical error during migration:', error);
        process.exit(1);
    }
}

migrate();