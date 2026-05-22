/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: controllers/syncController.js

/**
 * @file syncController.js
 * @description Controller responsible for handling batch synchronization requests
 * from the WordPress integration. It processes nodes (posts) and profiles (users)
 * ensuring idempotent upserts and data integrity.
 *
 * @author Quelora Architecture Team
 */

const crypto  = require('crypto');
const Post    = require('@quelora/common/models/Post');
const Profile = require('@quelora/common/models/Profile');
const { getClientPostConfig, getClientConfig, getClientCached, getClientVapidConfig, getClientNostrConfig, getClientP2pConfig } = require('@quelora/common/services/clientConfigService');

/**
 * Converts a raw node identifier (e.g. "post-34") to the 24-character
 * lowercase hex string used as MongoDB ObjectId, matching the browser-side
 * `toNodeId` contract in sidebar.js.
 *
 * @param {string} input - Raw node identifier.
 * @returns {string} 24-character lowercase hex string.
 */
function toNodeId(input) {
    const str = String(input);
    if (/^[0-9a-f]{24}$/.test(str.toLowerCase())) {
        return str.toLowerCase();
    }
    return crypto.createHash('sha256').update(str, 'utf8').digest('hex').substring(0, 24);
}

/**
 * Returns the integration configuration for a WordPress site.
 * Used by the plugin wizard to retrieve client settings and build sync endpoints.
 *
 * The response includes a sanitized QUELORA_CONFIG object (no secrets),
 * the tenant API URL, and the dashboard URL.
 *
 * @async
 * @function getIntegrationConfig
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
exports.getIntegrationConfig = async (req, res) => {
    const { cid } = req.params;

    try {
        const [config, client, postConfig, vapidConfig, nostrConfig, p2pConfig] = await Promise.all([
            getClientConfig(cid),
            getClientCached(cid),
            getClientPostConfig(cid),
            getClientVapidConfig(cid),
            getClientNostrConfig(cid),
            getClientP2pConfig(cid),
        ]);

        if (!config || !client) {
            return res.status(404).json({ success: false, message: 'Client not found' });
        }

        const apiUrl       = client.apiUrl  || process.env.PUBLIC_API_URL || null;
        const loginSource  = config.login   || {};
        const provDetails  = loginSource.providerDetails || {};

        const login = loginSource.queloraSession
            ? {
                queloraSession: true,
                baseUrl:        loginSource.baseUrl    || '',
                providers:      loginSource.providers  || [],
                providerDetails: Object.keys(provDetails).reduce((acc, provider) => {
                    if (loginSource.providers?.includes(provider)) {
                        acc[provider] = {
                            clientId: provDetails[provider]?.clientId || '',
                            ...(provider === 'Quelora' ? { enabled: provDetails[provider]?.enabled ?? false } : {}),
                        };
                    }
                    return acc;
                }, {}),
            }
            : {
                queloraSession:  false,
                loginUrl:        loginSource.loginUrl        || '',
                logoutUrl:       loginSource.logoutUrl       || '',
                registrationUrl: loginSource.registrationUrl || '',
            };

        const captchaSource    = config.captcha    || {};
        const authWidgetSource = config.authWidget  || {};
        const postConfigData   = postConfig         || {};

        const sanitizedConfig = {
            cid,
            apiUrl,
            siteUrl:      client.siteUrl || '',
            login,
            geolocation: {
                enabled:  config.geolocation?.enabled  ?? false,
                provider: config.geolocation?.provider || 'ipapi',
            },
            audio: postConfigData.audio || {
                enable_mic_transcription: false,
                save_comment_audio:       false,
                max_recording_seconds:    60,
                bitrate:                  16000,
            },
            vapid: {
                publicKey:  vapidConfig?.publicKey  || '',
                iconBase64: vapidConfig?.iconBase64 || '',
            },
            captcha: {
                enabled:  captchaSource.enabled  ?? false,
                provider: captchaSource.provider || 'turnstile',
                siteKey:  captchaSource.siteKey  || '',
            },
            authWidget: {
                enabled:  authWidgetSource.enabled  ?? false,
                selector: authWidgetSource.selector || '',
                position: authWidgetSource.position || 'inside',
            },
            entityConfig: config.entityConfig || {
                selector:             'article',
                entityIdAttribute:    'href',
                goTo:                 false,
                hrefAttribute:        'href',
                interactionPlacement: { position: 'after', relativeTo: '.article-actions', deterministic: false },
            },
            comments: {
                allowGif: postConfigData.comments?.allowGif ?? false,
            },
            nostrRelays: nostrConfig?.relays    || [],
            trackerUrls: p2pConfig?.trackerUrls || [],
            rtcServers:  p2pConfig?.rtcServers  || [],
        };

        return res.status(200).json({
            config:       sanitizedConfig,
            apiUrl,
            dashboardUrl: process.env.DASHBOARD_URL || null,
        });
    } catch (error) {
        console.error(`[SyncController] Integration config error for ${cid}:`, error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * Processes a batch of nodes (posts) sent from WordPress.
 * Utilizes MongoDB bulkWrite for highly efficient database operations.
 *
 * @async
 * @function batchUpsertNodes
 * @param {import('express').Request} req - The Express request object containing CID and items.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>} Sends a JSON response with the operation result.
 */
exports.batchUpsertNodes = async (req, res) => {
    const { cid } = req.params;
    const items = Array.isArray(req.body) ? req.body : req.body?.items;

    if (!Array.isArray(items)) {
        return res.status(400).json({
            success: false,
            message: 'Payload must contain an "items" array or a root-level array'
        });
    }

    try {
        let postConfig = await getClientPostConfig(cid);
        if (!postConfig) {
            postConfig = Post.getDefaultConfig();
        }

        const validItems = items.filter(item => item.nodeId != null);

        const operations = validItems.map(item => {
            const entityId = toNodeId(item.nodeId);
            return {
                updateOne: {
                    filter: { cid: cid, entity: entityId },
                    update: {
                        $set: {
                            title:               item.title,
                            description:         item.description,
                            link:                item.link,
                            type:                'article',
                            'metadata.tags':     item.tags,
                            'metadata.categories': item.categories,
                            'metadata.language': item.language,
                            updated_at:          new Date()
                        },
                        $setOnInsert: {
                            cid:        cid,
                            entity:     entityId,
                            reference:  item.link,
                            config:     postConfig,
                            created_at: new Date()
                        }
                    },
                    upsert: true
                }
            };
        });

        if (operations.length > 0) {
            await Post.bulkWrite(operations, { ordered: false });
        }

        return res.status(200).json({
            success: true,
            message: `Processed ${operations.length} of ${items.length} nodes.`
        });
    } catch (error) {
        console.error(`[SyncController] Nodes batch upsert error for ${cid}:`, error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error during nodes sync'
        });
    }
};

/**
 * Processes a batch of profiles (users) sent from WordPress.
 * Iterates through items to utilize Mongoose schema hooks (e.g., uniqueness validation, caching).
 *
 * @async
 * @function batchUpsertProfiles
 * @param {import('express').Request} req - The Express request object containing CID and items.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>} Sends a JSON response with the operation result.
 */
exports.batchUpsertProfiles = async (req, res) => {
    const { cid } = req.params;
    const items = Array.isArray(req.body) ? req.body : req.body?.items;

    if (!Array.isArray(items)) {
        return res.status(400).json({
            success: false,
            message: 'Payload must contain an "items" array or a root-level array'
        });
    }

    try {
        let processed = 0;
        
        for (const item of items) {
            try {
                await Profile.ensureProfileExists({
                    author: item.author,
                    name: item.name,
                    given_name: item.given_name,
                    family_name: item.family_name,
                    email: item.email,
                    picture: item.picture
                }, cid, null, { skipSuggestions: true });
                
                processed++;
            } catch (profileErr) {
                console.error(`[SyncController] Skipping profile ${item.author} for ${cid}:`, profileErr.message);
            }
        }

        return res.status(200).json({
            success: true,
            message: `Processed ${processed} of ${items.length} profiles.`
        });
    } catch (error) {
        console.error(`[SyncController] Profiles batch upsert error for ${cid}:`, error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error during profiles sync'
        });
    }
};