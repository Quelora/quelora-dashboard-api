/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./src/controllers/clientController.js
const { mongoose } = require('@quelora/common/db');
const Client = require('@quelora/common/models/Client');
const Profile = require('@quelora/common/models/Profile');
const Post = require('@quelora/common/models/Post');
const Comment = require('@quelora/common/models/Comment');
const Report = require('@quelora/common/models/Report');

const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const maxmind = require('maxmind');
const path = require('path');

const formatComment = require('@quelora/common/utils/formatComment');

const { decryptJSON, encryptJSON, generateKeyFromString, encrypt } = require('@quelora/common/utils/cipher');

const deepMerge = require('@quelora/common/utils/deepMerge');
const clientConfigService = require('@quelora/common/services/clientConfigService');
const geoService = require('@quelora/common/services/geoService');
const puppeteerService = require('../services/puppeteerService');

const { getLogs } = require('@quelora/common/services/loggerService');
const { cacheClient } = require('@quelora/common/services/cacheService');
const { deleteProfileCache } = require('@quelora/common/services/profileService');
const { moderateService } = require('@quelora/common/services/moderateService');
const { commentAnalysisNolanService } = require('../services/commentAnalysisNolanService');
const { getFilterCids, validateCidAccess } = require('../utils/accessControl');
const { toxicityService } = require('@quelora/common/services/toxicityService');
const { VALID_ENTERPRISE_MODULES, VALID_COMMUNITY_PLUGINS } = require('@quelora/common/utils/pluginRegistry');

/**
 * Generates a unique Client ID (CID).
 * @returns {Promise<string>} The newly generated unique CID.
 * @throws {Error} If unable to generate a unique CID after 5 attempts.
 */
const generateUniqueCID = async () => {
    let attempts = 0;
    while (attempts < 5) {
        const timestampPart = Date.now().toString(36).toUpperCase();
        const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
        const candidateCID = `QU-${timestampPart}-${randomPart}`;
        const exists = await Client.exists({ cid: candidateCID });
        if (!exists) return candidateCID;
        attempts++;
    }
    throw new Error('Failed to generate unique CID');
};

/**
 * Validates or generates a 24-character hex hash from a given input string.
 * @param {string} input - The input string to hash.
 * @returns {string|null} The 24-character hex hash or null if input is invalid.
 */
const generateHashIfNeeded = (input) => {
    try {
        if (!input) return null;
        const inputStr = String(input);
        const inputLower = inputStr.toLowerCase();
        const hashRegex = /^[0-9a-f]{24}$/;
        if (hashRegex.test(inputLower)) {
            return inputLower;
        }
        const hash = crypto.createHash('sha256');
        hash.update(inputStr, 'utf8');
        const hashHex = hash.digest('hex');
        return hashHex.substring(0, 24);
    } catch (error) {
        console.error('Error generating hash:', error);
        return null;
    }
};

/**
 * Creates or updates a Client configuration securely.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.upsertClient = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const userRole = req.user.role;
        const {
            cid,
            description,
            apiUrl,
            siteUrl,
            config,
            postConfig,
            vapid,
            email,
            turn,
            nostr,
            p2p,
            configEncrypted = config,
            postConfigEncrypted = postConfig,
            vapidEncrypted = vapid,
            emailEncrypted = email,
            turnEncrypted = turn,
            nostrEncrypted = nostr,
            p2pEncrypted = p2p
        } = req.body;

        if (!description || typeof description !== 'string' || description.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'Valid description is required' });
        }

        const decryptionKey = cid ? generateKeyFromString(cid) : null;

        const decryptField = (encryptedData) => {
            if (!encryptedData) return null;
            if (!decryptionKey) return encryptedData;
            try {
                return typeof encryptedData === 'string'
                    ? decryptJSON(encryptedData, decryptionKey)
                    : encryptedData;
            } catch (error) {
                throw new Error(`Failed to decrypt field: ${error.message}`);
            }
        };

        let finalConfig = {};
        let finalPostConfig = null;
        let finalVapid = null;
        let finalEmail = null;
        let finalTurn = null;
        let finalNostr = null;
        let finalP2p = null;

        try {
            if (configEncrypted) finalConfig = { ...decryptField(configEncrypted) };
            if (postConfigEncrypted) finalPostConfig = decryptField(postConfigEncrypted);
            if (vapidEncrypted) finalVapid = decryptField(vapidEncrypted);
            if (emailEncrypted) finalEmail = decryptField(emailEncrypted);
            if (turnEncrypted) finalTurn = decryptField(turnEncrypted);
            if (nostrEncrypted) finalNostr = decryptField(nostrEncrypted);
            if (p2pEncrypted) finalP2p = decryptField(p2pEncrypted);
        } catch (error) {
            return res.status(400).json({ success: false, error: error.message });
        }

        let targetCID = cid;
        let clientDoc;

        if (targetCID) {
            clientDoc = await Client.findOne({ cid: targetCID });
            if (!clientDoc) {
                return res.status(404).json({ success: false, error: 'Client not found' });
            }

            try {
                 await validateCidAccess(userId, userRole, targetCID);
            } catch (e) {
                return res.status(403).json({ success: false, error: 'Access denied to this client' });
            }

        } else {
            targetCID = await generateUniqueCID();
            clientDoc = new Client({
                cid: targetCID,
                users: [userId]
            });
        }

        clientDoc.description = description.trim();
        if (cid) {
            if (apiUrl) clientDoc.apiUrl = apiUrl;
        } else {
            clientDoc.apiUrl = process.env.PUBLIC_API_URL || '';
        }
        if (siteUrl) clientDoc.siteUrl = siteUrl;
        if (finalConfig) clientDoc.config = finalConfig;
        if (finalPostConfig) clientDoc.postConfig = finalPostConfig;
        if (finalVapid) clientDoc.vapid = finalVapid;
        if (finalEmail) clientDoc.email = finalEmail;
        if (finalTurn) clientDoc.turn = finalTurn;
        if (finalNostr) clientDoc.nostr = finalNostr;
        if (finalP2p) clientDoc.p2p = finalP2p;

        await clientDoc.save(); 

        let safeResilience = null;
        if (clientDoc.resilience && Object.keys(clientDoc.resilience).length > 0) {
            const { privateKey, privateKeyCipher, ...rest } = clientDoc.resilience;
            safeResilience = rest;
        }

        const encryptionKey = generateKeyFromString(clientDoc.cid);
        const encryptedClient = {
            cid: clientDoc.cid,
            description: clientDoc.description,
            apiUrl: clientDoc.apiUrl,
            siteUrl: clientDoc.siteUrl,
            config: encryptJSON(clientDoc.decryptConf(), encryptionKey),
            postConfig: encryptJSON(clientDoc.postConfig, encryptionKey),
            vapid: encryptJSON(clientDoc.decryptVapid(), encryptionKey),
            email: encryptJSON(clientDoc.decryptEmail(), encryptionKey),
            turn: encryptJSON(clientDoc.decryptTurn(), encryptionKey),
            nostr: encryptJSON(clientDoc.decryptNostr(), encryptionKey),
            p2p: encryptJSON(clientDoc.p2p, encryptionKey),
            resilience: safeResilience ? encryptJSON(safeResilience, encryptionKey) : null
        };

        return res.json({
            success: true,
            message: 'Client updated successfully',
            client: encryptedClient
        });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ success: false, error: 'Client CID or description already exists' });
        }
        next(error);
    }
};

/**
 * Generates asymmetric cryptographic keys for client resilience.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.generateResilienceKeys = async (req, res, next) => {
    try {
        const { cid } = req.body;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!cid) return res.status(400).json({ success: false, error: 'CID is required' });

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const clientDoc = await Client.findOne({ cid });
        if (!clientDoc) return res.status(404).json({ success: false, error: 'Client not found' });

        const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });

        const keyId = `kid_${crypto.randomBytes(4).toString('hex')}_${Date.now()}`;

        clientDoc.resilience = {
            enabled: true,
            algorithm: 'ed25519',
            keyId: keyId,
            publicKey: publicKey, 
            privateKey: privateKey, 
            updatedAt: new Date()
        };

        await clientDoc.save();
       
        return res.status(200).json({ 
            success: true, 
            message: 'Resilience keys generated. Private key encrypted by Model.',
            data: {
                cid: cid,
                resilience: {
                    enabled: true,
                    keyId: keyId,
                    algorithm: 'ed25519',
                    publicKey: publicKey,
                    updatedAt: clientDoc.resilience.updatedAt
                }
            }
        });

    } catch (error) {
        console.error('[ClientController] Error generating resilience keys:', error);
        next(error);
    }
};

/**
 * Logically soft-deletes a client configuration.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.deleteClient = async (req, res, next) => {
    try {
        const { cid } = req.params;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!/^QU-[A-Z0-9]{8}-[A-Z0-9]{5}$/.test(cid)) {
            return res.status(400).json({ success: false, error: 'Invalid CID format' });
        }

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const postCount = await Post.countDocuments({ cid });
        if (postCount > 0) {
            return res.status(400).json({ success: false, error: 'Cannot delete client with associated posts' });
        }

        const result = await Client.findOneAndDelete({ cid: cid });
        if (!result) {
            return res.status(404).json({ success: false, error: 'Client not found or access denied' });
        }

        res.status(200).json({ success: true, message: 'Client deleted successfully' });
    } catch (error) {
        console.error('Error in deleteClient:', error);
        next(error);
    }
};

/**
 * Retrieves a paginated list of user profiles tied to a specific Client.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.getUsersByClient = async (req, res, next) => {
    try {
        const { cid, page = 1, limit = 10, search = '', sort = 'created_at', order = 'desc' } = req.query;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!cid) return res.status(400).json({ success: false, error: 'Client ID is required' });

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const query = { cid: cid };
        if (search) {
            const searchRegex = { $regex: search, $options: 'i' };
            query.$or = [
                { name: searchRegex },
                { given_name: searchRegex },
                { family_name: searchRegex }
            ];
        }

        const pageNumber = +page;
        const limitNumber = +limit;
        const skip = (pageNumber - 1) * limitNumber;
        const sortOptions = { [sort]: order === 'desc' ? -1 : 1 };

        const [users, totalUsers] = await Promise.all([
            Profile.find(query)
                .select('cid author name given_name family_name email picture locale bookmarksCount commentsCount followersCount followingCount likesCount sharesCount settings pushSubscriptions location geohash lastActivityViewed created_at updated_at isBanned')
                .sort(sortOptions)
                .skip(skip)
                .limit(limitNumber)
                .lean(),
            Profile.countDocuments(query)
        ]);

        const totalPages = Math.ceil(totalUsers / limitNumber);

        res.status(200).json({
            success: true,
            data: {
                users,
                pagination: {
                    totalItems: totalUsers,
                    totalPages,
                    currentPage: pageNumber,
                    itemsPerPage: limitNumber,
                    hasNext: pageNumber < totalPages,
                    hasPrevious: pageNumber > 1
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves a paginated list of comments tied to a specific Post ID.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.getPostComments = async (req, res, next) => {
    try {
        const { postId } = req.params;
        const currentUser = req.user?.username || '';
        const userId = req.user._id;
        const userRole = req.user.role;
        const { page = 1, limit = 10, search, author, lastCommentId } = req.query;

        if (!mongoose.Types.ObjectId.isValid(postId)) {
            return res.status(400).json({ success: false, error: 'Invalid post ID format' });
        }

        const post = await Post.findOne({ _id: postId, 'deletion.status': 'active' })
            .select('description cid config.interaction.allow_comments config.moderation.enable_toxicity_filter config.visibility config.moderation.banned_words config.moderation.enable_content_moderation config.moderation.moderation_prompt')
            .lean();

        if (!post) return res.status(404).json({ success: false, error: 'Post not found' });

        try {
            await validateCidAccess(userId, userRole, post.cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const commentQuery = { post: postId, parent: null, visible: true };
        if (search) commentQuery.text = { $regex: search, $options: 'i' };
        if (author) commentQuery.author = author;
        if (lastCommentId && mongoose.Types.ObjectId.isValid(lastCommentId)) {
            commentQuery._id = { $lt: new mongoose.Types.ObjectId(lastCommentId) };
        }

        const pageNumber = +page;
        const limitNumber = +limit;
        const skip = (pageNumber - 1) * limitNumber;

        const [comments, totalComments] = await Promise.all([
            Comment.find(commentQuery).sort({ _id: -1 }).skip(skip).limit(limitNumber).lean(),
            Comment.countDocuments(commentQuery)
        ]);

        const repliesByParentId = new Map();
        await Promise.all(comments.map(async (comment) => {
            if (comment.repliesCount > 0) {
                const replies = await Comment.find({ parent: comment._id, visible: true }).sort({ _id: -1 }).limit(2).lean();
                repliesByParentId.set(comment._id.toString(), replies);
            }
        }));

        const allAuthorIds = [...comments.map(c => c.author), ...Array.from(repliesByParentId.values()).flat().map(r => r.author)];
        const profiles = await Profile.find({ author: { $in: allAuthorIds } }).select('author name given_name family_name picture locale created_at').lean();
        const profileMap = profiles.reduce((map, p) => { map[p.author] = p; return map; }, {});

        const formattedComments = comments.map(comment => {
            const profile = profileMap[comment.author];
            const formatted = formatComment({ ...comment, replies_visibles: comment.repliesCount || 0 }, profile, currentUser);
            const recentReplies = repliesByParentId.get(comment._id.toString()) || [];
            if (recentReplies.length > 0) {
                formatted.replies = recentReplies.map(reply => formatComment(reply, profileMap[reply.author], currentUser));
            }
            return formatted;
        });

        const totalPages = Math.ceil(totalComments / limitNumber);
        const { interaction, moderation, visibility } = post.config;

        res.status(200).json({
            success: true,
            data: {
                comments: formattedComments,
                postConfig: {
                    allowComments: interaction.allow_comments,
                    toxicityFilter: moderation.enable_toxicity_filter,
                    description: post.description,
                    visibility: visibility,
                    banned_words: moderation.banned_words,
                    enable_content_moderation: moderation.enable_content_moderation,
                    moderation_prompt: moderation.moderation_prompt
                },
                pagination: {
                    totalItems: totalComments,
                    totalPages,
                    currentPage: pageNumber,
                    itemsPerPage: limitNumber,
                    hasNext: pageNumber < totalPages,
                    hasPrevious: pageNumber > 1,
                    lastCommentId: comments.length > 0 ? comments[comments.length - 1]._id : null
                }
            }
        });

    } catch (error) {
        next(error);
    }
};

/**
 * Creates or updates a Post associated with a specific entity.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.upsertPost = async (req, res, next) => {
    try {
        const { cid, config, description, entity, ...otherFields } = req.body;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!cid) return res.status(400).json({ message: 'CID missing' });

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ message: 'Access denied' });
        }

        if (!mongoose.Types.ObjectId.isValid(entity)) return res.status(400).json({ message: 'Invalid entity ID.' });

        const defaultPostConfig = Post.schema.path('config').defaultValue;
        const finalConfig = deepMerge(JSON.parse(JSON.stringify(defaultPostConfig)), config || {});

        const postData = {
            entity,
            cid,
            config: finalConfig,
            description,
            updated_at: new Date(),
            ...otherFields
        };

        const updatedPost = await Post.findOneAndUpdate(
            { entity },
            postData,
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        const message = updatedPost.created_at.getTime() === updatedPost.updated_at.getTime()
            ? 'Post successfully created.'
            : 'Post successfully updated.';

        res.status(200).json({ message, post: updatedPost });
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves an individual Post by CID and entity ID.
 *
 * Optimistic creation strategy:
 * If the post does not exist in the database but the request carries
 * sufficient metadata in the query string (at minimum a `description`),
 * the endpoint will transparently create the post and return it with
 * HTTP 201 instead of responding with 404.
 *
 * Creation is only attempted when ALL of the following conditions are met:
 * 1. The entity ID is a valid 24-character hex ObjectId.
 * 2. The authenticated user has write access to the supplied CID.
 * 3. At least `description` is present in the query string.
 *
 * Query parameters used for optimistic creation:
 * - `title`       {string}  Post title.
 * - `description` {string}  Post body / summary (required).
 * - `link`        {string}  External URL associated with the post.
 * - `category`    {string}  Content category (defaults to `"General"`).
 * - `tags`        {string}  Comma-separated tag list.
 * - `language`    {string}  BCP-47 language tag (e.g. `"en_US"`). Normalised
 * to the two-letter ISO 639-1 code internally.
 *
 * @param {Object}   req        - Express request object.
 * @param {Object}   req.params - Route parameters.
 * @param {string}   req.params.cid    - Client identifier.
 * @param {string}   req.params.entity - Post entity identifier (ObjectId hex).
 * @param {Object}   req.query  - Query string parameters (used for optimistic creation).
 * @param {Object}   res        - Express response object.
 * @param {Function} next       - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.getPost = async (req, res, next) => {
    try {
        const { cid, entity } = req.params;
        const userId   = req.user._id;
        const userRole = req.user.role;

        if (!entity || !cid) {
            return res.status(400).json({ success: false, error: 'CID and entity are required' });
        }

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const hashEntity = generateHashIfNeeded(entity);

        const post = await Post.findOne({
            entity: hashEntity,
            cid:    cid,
            'deletion.status': 'active'
        })
        .select('title description entity cid reference config created_at updated_at likesCount sharesCount commentsCount deletion link')
        .lean();

        if (post) {
            const postData = {
                id: post._id,
                ...post,
                config: {
                    visibility:  post.config?.visibility  || 'public',
                    interaction: post.config?.interaction || {},
                    category:    post.config?.category    || null,
                    tags:        post.config?.tags        || [],
                    liveMode:    post.config?.liveMode    || {},
                    moderation:  post.config?.moderation  || {},
                },
                stats: {
                    likesCount:    post.likesCount    || 0,
                    sharesCount:   post.sharesCount   || 0,
                    commentsCount: post.commentsCount || 0,
                },
            };
            return res.status(200).json({ success: true, data: postData });
        }

        // --- Optimistic creation ---

        const {
            title       = '',
            description = '',
            link        = '',
            category    = 'General',
            tags        = '',
            language    = 'en',
        } = req.query;

        if (!description.trim()) {
            return res.status(404).json({
                success: false,
                error:   'Post not found and insufficient metadata to create it',
            });
        }

        if (!mongoose.Types.ObjectId.isValid(entity)) {
            return res.status(400).json({ success: false, error: 'Invalid entity ID format' });
        }

        /**
         * Normalises a BCP-47 language tag to its two-letter ISO 639-1 code.
         * Falls back to `"en"` for unsupported or empty values.
         *
         * @param {string} raw - Raw language string (e.g. `"en_US"`).
         * @returns {string} Two-letter language code.
         */
        const normaliseLanguage = (raw = '') => {
            const supported = ['en', 'es', 'fr'];
            const code      = raw.split(/[-_]/)[0].toLowerCase();
            return supported.includes(code) ? code : 'en';
        };

        const parsedTags = tags
            ? tags.split(',').map(t => t.trim()).filter(Boolean)
            : [];

        const defaultPostConfig = Post.schema.path('config').defaultValue;
        const incomingConfig    = {
            category:    category || 'General',
            tags:        parsedTags,
            language: {
                post_language: normaliseLanguage(language),
                auto_translate: false,
            },
        };

        const finalConfig = deepMerge(
            JSON.parse(JSON.stringify(defaultPostConfig)),
            incomingConfig
        );

        const postData = {
            entity:      entity,
            cid:         cid,
            title:       title.trim(),
            description: description.trim(),
            link:        link.trim(),
            config:      finalConfig,
            updated_at:  new Date(),
        };

        const createdPost = await Post.findOneAndUpdate(
            { entity: entity },
            postData,
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        const responseData = {
            id: createdPost._id,
            ...createdPost.toObject(),
            config: {
                visibility:  createdPost.config?.visibility  || 'public',
                interaction: createdPost.config?.interaction || {},
                category:    createdPost.config?.category    || null,
                tags:        createdPost.config?.tags        || [],
                liveMode:    createdPost.config?.liveMode    || {},
                moderation:  createdPost.config?.moderation  || {},
            },
            stats: {
                likesCount:    createdPost.likesCount    || 0,
                sharesCount:   createdPost.sharesCount   || 0,
                commentsCount: createdPost.commentsCount || 0,
            },
        };

        return res.status(201).json({ success: true, created: true, data: responseData });

    } catch (error) {
        console.error('Error in getPost:', error);
        next(error);
    }
};

/**
 * Trashes an active Post.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.trashPost = async (req, res, next) => {
    try {
        const { cid, entity } = req.body;
        const adminId = req.user?._id;
        const userRole = req.user.role;

        if (!mongoose.Types.ObjectId.isValid(entity)) return res.status(400).json({ message: 'Invalid entity ID.' });

        try {
            await validateCidAccess(adminId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const postObject = await Post.findOne({ cid, entity, 'deletion.status': 'active' });
        if (!postObject) return res.status(404).json({ message: 'Post not found' });

        await Post.moveToTrash(postObject._id, adminId);
        res.status(200).json({ success: true, message: 'Post moved to trash successfully.', postObject });
    } catch (error) {
        next(error);
    }
};

/**
 * Restores a trashed Post back to active status.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.restorePostFromTrash = async (req, res, next) => {
    try {
        const { cid, entity } = req.body;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!mongoose.Types.ObjectId.isValid(entity)) return res.status(400).json({ message: 'Invalid entity ID.' });

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const postObject = await Post.findOne({ cid, entity, 'deletion.status': 'trash' });
        if (!postObject) return res.status(404).json({ message: 'Post not found in trash' });

        await Post.restoreFromTrash(postObject._id);
        res.status(200).json({ success: true, message: 'Post successfully restored.', postObject });
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves a list of paginated posts linked to a Client configuration.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.getClientPosts = async (req, res, next) => {
    try {
        const user = req.user;
        const { page = 1, limit = 10, cid, sort = 'created_at', order = 'desc', search, category, visibility, dateFrom, dateTo, allowComments, allowLikes, deleted = 'false', isLive } = req.query;

        let allowedCids;
        try {
            allowedCids = await getFilterCids(user._id, user.role, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: e.message });
        }

        const query = {
            cid: { $in: allowedCids }
        };

        if (search) {
            const searchRegex = { $regex: search, $options: 'i' };
            query.$or = [{ reference: searchRegex }, { title: searchRegex }, { description: searchRegex }, { 'config.tags': searchRegex }, { 'config.category': searchRegex }];
        }
        if (category) query['config.category'] = { $regex: category, $options: 'i' };
        if (visibility) query['config.visibility'] = { $regex: new RegExp(`^${visibility}$`, 'i') };
        if (dateFrom || dateTo) {
            query.created_at = {};
            if (dateFrom) query.created_at.$gte = new Date(dateFrom);
            if (dateTo) query.created_at.$lte = new Date(dateTo);
        }
        if (allowComments !== undefined) query['config.interaction.allow_comments'] = allowComments === 'true';
        if (allowLikes !== undefined) query['config.interaction.allow_likes'] = allowLikes === 'true';
        if (isLive === 'true') query['config.liveMode.isLiveActive'] = true;
        query['deletion.status'] = deleted === 'true' ? 'trash' : 'active';

        const pageNumber = +page;
        const limitNumber = +limit;
        const skip = (pageNumber - 1) * limitNumber;
        const sortOrder = order === 'asc' ? 1 : -1;
        const sortOptions = { [sort]: sortOrder, _id: -1 };

        const [posts, totalItems] = await Promise.all([
            Post.find(query).sort(sortOptions).skip(skip).limit(limitNumber).select('entity title description created_at config likesCount sharesCount commentsCount deletion cid reference _id deleted_at').lean(),
            Post.countDocuments(query)
        ]);

        const totalPages = Math.ceil(totalItems / limitNumber);

        res.json({
            success: true,
            data: {
                posts,
                pagination: {
                    totalItems,
                    totalPages,
                    currentPage: pageNumber,
                    itemsPerPage: limitNumber,
                    hasNext: pageNumber < totalPages,
                    hasPrevious: pageNumber > 1,
                    filters: req.query
                }
            }
        });

    } catch (error) {
        console.error('Error fetching client posts:', error);
        next(error);
    }
};

/**
 * Conducts a manual evaluation against the toxicity filter settings.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.moderationTest = async (req, res, next) => {
    try {
        const { cid, text, config } = req.body;
        const userId = req.user._id;
        const userRole = req.user.role;

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const clientModerationConfig = await clientConfigService.getClientConfig(cid, 'moderation');
        if (!clientModerationConfig?.enabled || !clientModerationConfig?.apiKey) {
            console.warn('Content moderation incomplete config.');
        }

        if (config && typeof config === 'object') clientModerationConfig.configJson = JSON.stringify(config);

        const { isRejected, reason } = await moderateService(cid, text, clientModerationConfig);

        res.json({ success: true, isApproved: !isRejected, reason });
    } catch (error) {
        console.error('Error in moderationTest:', error);
        next(error);
    }
};

/**
 * Conducts a manual evaluation against the toxicity engine directly via the frontend payload.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.testToxicity = async (req, res, next) => {
    try {
        const { cid } = req.params;
        const { text, toxicityConfig, language = 'es' } = req.body;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (cid !== 'new_client') {
            try {
                await validateCidAccess(userId, userRole, cid);
            } catch (e) {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }
        }

        if (!text) {
            return res.status(400).json({ success: false, error: 'Text is required for analysis.' });
        }

        const result = await toxicityService(text, language, toxicityConfig, cid);

        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Error in testToxicity:', error);
        next(error);
    }
};

/**
 * Executes an automated page scraping test for discovery capabilities.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.testDiscovery = async (req, res, next) => {
    const { url } = req.query;
    try {
        if (!url) return res.status(400).json({ success: false, error: "URL required" });
        const result = await puppeteerService.scrapePageData(url);
        await puppeteerService.closeBrowser();
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Error in testDiscovery:', error);
        next(error);
    }
};

/**
 * Generates an operative snapshot of systemic resource consumption.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.getMonitoring = async (req, res, next) => {
    try {
        const { from, level } = req.query;
        let logs = getLogs();
        if (from) {
            const fromDate = new Date(from);
            if (!isNaN(fromDate)) logs = logs.filter(log => new Date(log.time) > fromDate);
        }
        if (level) logs = logs.filter(log => log.level.toLowerCase() === level.toLowerCase());

        const db = mongoose.connection.db;
        const [dbStats, serverStatus, redisInfo] = await Promise.all([
            db.stats(),
            db.admin().serverStatus(),
            cacheClient.info()
        ]);

        const redisStats = redisInfo.split('\r\n').reduce((acc, line) => {
            if (line && !line.startsWith('#')) {
                const [key, value] = line.split(':');
                if (key && value) acc[key] = isNaN(value) ? value : Number(value);
            }
            return acc;
        }, {});

        res.status(200).json({
            success: true,
            data: {
                timestamp: new Date(),
                app: {
                    system: { cpus: os.cpus().length, totalMemory: os.totalmem(), freeMemory: os.freemem() },
                    process: { memoryUsage: process.memoryUsage(), uptime: process.uptime() }
                },
                database: {
                    connections: serverStatus.connections,
                    memory: serverStatus.mem,
                    storage: {
                        data: dbStats.dataSize,
                        indexes: dbStats.indexSize
                    },
                    operations: serverStatus.opcounters, 
                    version: serverStatus.version 
                },
                cache: { redis: redisStats },
                logs
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves a list of aggregated pending reports natively mapped to a polymorphic architecture.
 * Refactored to operate iteratively over multiple report boundaries with strict projection rules
 * avoiding exposure of highly sensitive fields (e.g. push keys, geolocation).
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.getReports = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, cid, sort = 'report_count', order = 'desc' } = req.query;
        const userId = req.user._id;
        const userRole = req.user.role;

        let targetCIDs;
        try {
            targetCIDs = await getFilterCids(userId, userRole, cid === 'all' ? null : cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: e.message });
        }
        
        const limitNumber = +limit;
        
        if (targetCIDs.length === 0) {
             return res.json({
                success: true,
                data: {
                    reports: [],
                    pagination: { totalItems: 0, totalPages: 0, currentPage: 1, itemsPerPage: limitNumber }
                }
            });
        }

        const pageNumber = +page;
        const skip = (pageNumber - 1) * limitNumber;
        const sortOrder = order === 'asc' ? 1 : -1;

        const matchCidExpr = {
            $expr: {
                $or: [
                    { $in: ["$post.cid", targetCIDs] },
                    { $in: ["$reported_profile_doc.cid", targetCIDs] }
                ]
            }
        };

        const countPipeline = [
            { $match: { status: 'pending' } },
            { $lookup: { from: 'posts', localField: 'context_id', foreignField: '_id', as: 'post' } },
            { $unwind: { path: "$post", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'profiles', localField: 'reported_profile', foreignField: '_id', as: 'reported_profile_doc' } },
            { $unwind: { path: "$reported_profile_doc", preserveNullAndEmptyArrays: true } },
            { $match: matchCidExpr },
            { $count: "totalItems" }
        ];

        const dataPipeline = [
            { $match: { status: 'pending' } },
            { $lookup: { from: 'posts', localField: 'context_id', foreignField: '_id', as: 'post' } },
            { $unwind: { path: "$post", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'profiles', localField: 'reported_profile', foreignField: '_id', as: 'reported_profile_doc' } },
            { $unwind: { path: "$reported_profile_doc", preserveNullAndEmptyArrays: true } },
            { $match: matchCidExpr },
            { $addFields: { report_count: { $size: "$reports" } } },
            { $sort: { ...(sort === 'report_count' ? { report_count: sortOrder } : { [sort]: sortOrder }), _id: -1 } },
            { $skip: skip },
            { $limit: limitNumber },
            {
                $lookup: {
                    from: 'comments',
                    let: { targetId: '$target_id', tType: '$target_type' },
                    pipeline: [
                        { $match: { $expr: { $and: [ { $eq: ['$_id', '$$targetId'] }, { $eq: ['$$tType', 'comment'] } ] } } },
                        { $project: { _id: 1, text: 1, visible: 1 } }
                    ],
                    as: 'comment'
                }
            },
            { $unwind: { path: "$comment", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 1,
                    target_type: 1,
                    target_id: 1,
                    context_id: 1,
                    status: 1,
                    created_at: 1,
                    report_count: 1,
                    "reports.report_type": 1,
                    "post._id": 1,
                    "post.title": 1,
                    "post.cid": 1,
                    "reported_profile_doc._id": 1,
                    "reported_profile_doc.name": 1,
                    "reported_profile_doc.author": 1,
                    "reported_profile_doc.email": 1,
                    "reported_profile_doc.isBanned": 1,
                    "reported_profile_doc.cid": 1,
                    "comment": 1
                }
            }
        ];

        const [totalResult, data] = await Promise.all([
            Report.aggregate(countPipeline),
            Report.aggregate(dataPipeline)
        ]);

        const totalItems = totalResult[0]?.totalItems || 0;
        res.json({
            success: true,
            data: {
                reports: data,
                pagination: { totalItems, totalPages: Math.ceil(totalItems / limitNumber), currentPage: pageNumber, itemsPerPage: limitNumber }
            }
        });
    } catch (error) {
        console.error('Error fetching reports:', error);
        next(error);
    }
};

/**
 * Closes an active report natively determining context origins properly mapped over polymorphic collections.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.resolveReport = async (req, res, next) => {
    try {
        const { reportId } = req.params;
        const { resolution_reason } = req.body;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!mongoose.Types.ObjectId.isValid(reportId)) return res.status(400).json({ success: false, error: 'Invalid Report ID' });

        const report = await Report.findById(reportId)
            .populate('context_id', 'cid')
            .populate('reported_profile', 'cid');
            
        if (!report) return res.status(404).json({ success: false, error: 'Report not found' });

        const clientCid = report.target_type === 'comment'
            ? report.context_id?.cid
            : report.reported_profile?.cid;

        try {
            await validateCidAccess(userId, userRole, clientCid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        report.status = 'resolved';
        if (resolution_reason) report.resolution_reason = resolution_reason;
        await report.save();

        res.json({ success: true, data: report });
    } catch (error) {
        console.error('Error resolving report:', error);
        next(error);
    }
};

/**
 * Handles toggling global ban statuses against a specific CID constraint.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @param {boolean} banStatus - The targeted ban status.
 * @returns {Promise<void>}
 */
const updateBanStatus = async (req, res, next, banStatus) => {
    try {
        const { author } = req.params;
        const { cid } = req.query;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!cid) return res.status(400).json({ success: false, error: 'Client ID required' });

        const profileToUpdate = await Profile.findOne({ author: author, cid: cid });
        if (!profileToUpdate) return res.status(404).json({ success: false, error: 'Profile not found' });

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        profileToUpdate.isBanned = banStatus;
        await profileToUpdate.save();
        await deleteProfileCache(profileToUpdate.cid, profileToUpdate.author);

        res.status(200).json({ success: true, message: `User ${banStatus ? 'banned' : 'unbanned'}`, data: profileToUpdate });
    } catch (error) {
        console.error(`Error in updateBanStatus:`, error);
        next(error);
    }
};

/**
 * Ban user explicitly.
 */
exports.banUser = (req, res, next) => updateBanStatus(req, res, next, true);

/**
 * Unban user explicitly.
 */
exports.unbanUser = (req, res, next) => updateBanStatus(req, res, next, false);

/**
 * Handles modifying absolute visibility over a registered Comment interaction natively mapping CID validation.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @param {boolean} visible - Visibility flag target.
 * @returns {Promise<void>}
 */
const updateCommentVisibility = async (req, res, next, visible) => {
    try {
        const { commentId } = req.params;
        const { cid } = req.query;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!cid) return res.status(400).json({ success: false, error: 'CID required' });
        if (!mongoose.Types.ObjectId.isValid(commentId)) return res.status(400).json({ success: false, error: 'Invalid ID' });

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        
        const comment = await Comment.findById(commentId).populate('post', 'cid');
        if (!comment || !comment.post) return res.status(404).json({ success: false, error: 'Comment/Post not found' });

        if (comment.post.cid !== cid) return res.status(403).json({ success: false, error: 'CID mismatch' });

        visible ? await Comment.unhide(commentId) : await Comment.hide(commentId);
        res.status(200).json({ success: true, message: `Comment ${visible ? 'restored' : 'hidden'}` });
    } catch (error) {
        console.error(`Error in updateCommentVisibility:`, error);
        next(error);
    }
};

/**
 * Explicitly hides comment.
 */
exports.hideComment = (req, res, next) => updateCommentVisibility(req, res, next, false);

/**
 * Explicitly unhides comment.
 */
exports.unhideComment = (req, res, next) => updateCommentVisibility(req, res, next, true);

/**
 * Retrieves the timeline of comments provided by a singular unique author within the allowed boundaries.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.getCommentsListByUser = async (req, res, next) => {
    try {
        const { author } = req.params;
        const { cid, page = 1, limit = 10, search = '' } = req.query;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!cid) return res.status(400).json({ success: false, error: 'CID required' });

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const profile = await Profile.exists({ author: author, cid: cid });
        if (!profile) return res.status(404).json({ success: false, error: 'Profile not found' });

        const pageNumber = parseInt(page);
        const limitNumber = parseInt(limit);
        const skip = (pageNumber - 1) * limitNumber;

        const postIds = await Post.find({ cid: cid }).select('_id');
        const commentsQuery = { author: author, post: { $in: postIds.map(p => p._id) } };
        if (search) commentsQuery.text = { $regex: search, $options: 'i' };

        const [comments, totalItems] = await Promise.all([
            Comment.find(commentsQuery).sort({ created_at: -1 }).skip(skip).limit(limitNumber).populate('post', 'title entity').lean(),
            Comment.countDocuments(commentsQuery)
        ]);

        res.status(200).json({
            success: true,
            data: { comments, pagination: { totalItems, totalPages: Math.ceil(totalItems / limitNumber), currentPage: pageNumber, itemsPerPage: limitNumber } }
        });
    } catch (error) {
        console.error(`Error in getCommentsListByUser:`, error);
        next(error);
    }
};

/**
 * Extrapolates aggregated metrics measuring the organic reach generated by an author.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.getUserCommentStats = async (req, res, next) => {
    try {
        const { author } = req.params;
        const { cid, dateFrom, dateTo } = req.query;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!cid) return res.status(400).json({ success: false, error: 'CID required' });

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const postIds = await Post.find({ cid: cid }).select('_id');
        const baseQuery = { author: author, post: { $in: postIds.map(p => p._id) } };
        if (dateFrom && dateTo) baseQuery.created_at = { $gte: new Date(dateFrom), $lte: new Date(dateTo) };

        const result = await Comment.aggregate([
            { $match: baseQuery },
            {
                $facet: {
                    totals: [{ $group: { _id: null, totalComments: { $sum: 1 }, totalLikesReceived: { $sum: "$likesCount" }, totalRepliesReceived: { $sum: "$repliesCount" } } }],
                    chartData: [
                        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } }, count: { $sum: 1 } } },
                        { $sort: { _id: 1 } },
                        { $project: { date: "$_id", count: 1, _id: 0 } }
                    ]
                }
            }
        ]);

        const stats = result[0]?.totals[0] || { totalComments: 0, totalLikesReceived: 0, totalRepliesReceived: 0 };
        res.status(200).json({ success: true, data: { stats: { ...stats, chartData: result[0]?.chartData || [] } } });
    } catch (error) {
        console.error(`Error in getUserCommentStats:`, error);
        next(error);
    }
};

/**
 * Transmits historic comments into the Nolan analyzer for semantic processing.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {Promise<void>}
 */
exports.analyzeAuthorNolanChart = async (req, res) => {
    try {
        const { author } = req.params;
        const { cid, limit } = req.query;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!cid || !author) return res.status(400).json({ error: 'CID and author required' });

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const commentObjects = await Comment.find({ author }).select('text -_id').sort({ created_at: -1 }).limit(parseInt(limit, 10) || 50);
        if (!commentObjects.length) return res.status(404).json({ error: 'No comments found' });

        const result = await commentAnalysisNolanService(cid, commentObjects.map(c => c.text));
        if (result.analysis) return res.status(200).json(result.analysis);
        return res.status(500).json({ error: result.reason || 'Error' });
    } catch (error) {
        console.error('Error in analyzeAuthorNolanChart:', error.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

/**
 * Operates an atomic GeoIP translation lookup matching the provided node payload constraint format.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.testGeolocation = async (req, res, next) => {
    try {
        const { cid, ip, config } = req.body;
        const userId = req.user._id;
        const userRole = req.user.role;

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (!ip) return res.status(400).json({ success: false, error: 'IP is required' });

        if (!config || !config.backend || !config.backend.dbPath) {
             return res.status(400).json({ success: false, error: 'Backend configuration with dbPath is required' });
        }

        const rawDbPath = config.backend.dbPath;

        const directory = path.dirname(rawDbPath);
        const filename = path.basename(rawDbPath);
        const finalFilename = `${cid}_${filename}`; 
        const realDbPath = path.join(directory, finalFilename);

        if (!fs.existsSync(realDbPath)) {
            return res.status(404).json({ 
                success: false, 
                error: `Database file not found. Expected at: ${realDbPath}` 
            });
        }

        let lookup;
        try {
            lookup = await maxmind.open(realDbPath);
        } catch (err) {
            return res.status(500).json({ success: false, error: `Failed to open database: ${err.message}` });
        }

        const geo = lookup.get(ip);

        if (!geo) {
            return res.json({ success: true, found: false, message: 'IP not found in database' });
        }

        const result = {
            ip,
            country: geo.country?.names?.en || 'Unknown',
            countryCode: geo.country?.iso_code || 'UNK',
            region: geo.subdivisions?.[0]?.names?.en || 'Unknown',
            regionCode: geo.subdivisions?.[0]?.iso_code || 'UNK',
            city: geo.city?.names?.en || 'Unknown',
            lat: geo.location?.latitude || 'Unknown',
            lon: geo.location?.longitude || 'Unknown'
        };

        res.json({ success: true, found: true, data: result });

    } catch (error) {
        console.error('Error in testGeolocation:', error);
        next(error);
    }
};

/**
 * Forces provider logic overrides commanding the GeoIP integration update routines forcefully.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>}
 */
exports.forceGeoUpdate = async (req, res, next) => {
    try {
        const { cid } = req.body;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!cid) return res.status(400).json({ success: false, error: 'CID is required' });

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const clientDoc = await Client.findOne({ cid });
        if (!clientDoc) return res.status(404).json({ success: false, error: 'Client not found' });

        const config = clientDoc.decryptConf();
        const geoConfig = config.geolocation?.backend;

        if (!geoConfig || !geoConfig.provider) {
            return res.status(400).json({ success: false, error: 'Geolocation backend not configured' });
        }

        await geoService.updateProvider(cid, geoConfig, true);

        res.json({ 
            success: true, 
            message: 'GeoIP database update triggered successfully.' 
        });

    } catch (error) {
        console.error('[ClientController] Error forcing geo update:', error);
        next(error);
    }
};

// ---------------------------------------------------------------------------
// PATCH /client/:cid/quick-setup
// Applies basic wizard configuration to an existing client.
// Only the authenticated admin who owns the client may call this.
// ---------------------------------------------------------------------------

exports.quickSetup = async (req, res, next) => {
    try {
        const { cid } = req.params;
        const userId  = req.user._id;
        const userRole = req.user.role;

        const clientDoc = await Client.findOne({ cid });
        if (!clientDoc) {
            return res.status(404).json({ success: false, error: 'Client not found.' });
        }

        try {
            await require('../utils/accessControl').validateCidAccess(userId, userRole, cid);
        } catch {
            return res.status(403).json({ success: false, error: 'Access denied to this client.' });
        }

        const { siteName, siteUrl, description, language } = req.body;
        const incomingConfig    = req.body.config       || {};
        const incomingLogin     = incomingConfig.login  || {};
        const incomingEntity    = incomingConfig.entityConfig || {};
        const incomingCors      = incomingConfig.cors   || {};

        if (description || siteName) clientDoc.description = (description || siteName).trim();
        if (siteUrl) clientDoc.siteUrl = siteUrl.trim();

        // Build the config patch — only touch keys provided by the wizard
        const existingConfig = clientDoc.config ? JSON.parse(JSON.stringify(clientDoc.config)) : {};

        const useQuelora = incomingLogin.queloraSession === true;

        const loginPatch = {
            ...(existingConfig.login || {}),
            queloraSession:  useQuelora,
            jwtSecret:       incomingLogin.jwtSecret || existingConfig.login?.jwtSecret || '',
            loginUrl:        incomingLogin.loginUrl  || '',
            logoutUrl:       incomingLogin.logoutUrl || '',
            registrationUrl: incomingLogin.registrationUrl || '',
            providers:       useQuelora ? ['Quelora'] : (incomingLogin.providers || existingConfig.login?.providers || []),
            providerDetails: useQuelora
                ? { Quelora: { enabled: true } }
                : (incomingLogin.providerDetails || existingConfig.login?.providerDetails || {}),
            baseUrl: siteUrl || existingConfig.login?.baseUrl || '',
        };

        const placement = incomingEntity.interactionPlacement || {};
        const entityConfigPatch = {
            ...(existingConfig.entityConfig || {}),
            selector:          incomingEntity.selector          || existingConfig.entityConfig?.selector          || 'article',
            entityIdAttribute: incomingEntity.entityIdAttribute || existingConfig.entityConfig?.entityIdAttribute || 'id',
            goTo:              incomingEntity.goTo === true,
            hrefAttribute:     incomingEntity.hrefAttribute     || existingConfig.entityConfig?.hrefAttribute     || 'href',
            interactionPlacement: {
                position:      placement.position      || 'after',
                relativeTo:    placement.relativeTo    || '',
                deterministic: placement.deterministic === true,
            },
        };

        const existingOrigins = Array.isArray(existingConfig.cors?.allowedOrigins)
            ? existingConfig.cors.allowedOrigins
            : [];
        const siteUrlClean = siteUrl ? siteUrl.trim() : null;
        const updatedOrigins = siteUrlClean && !existingOrigins.includes(siteUrlClean)
            ? [...existingOrigins, siteUrlClean]
            : existingOrigins;

        const corsPatch = {
            ...(existingConfig.cors || {}),
            ...(siteUrlClean ? { enabled: true, allowedOrigins: updatedOrigins } : {}),
        };

        clientDoc.config = {
            ...existingConfig,
            login:        loginPatch,
            entityConfig: entityConfigPatch,
            cors:         corsPatch,
            ...(language ? { language: { default: language } } : {}),
        };

        // Seed postConfig with defaults if this is a brand-new client
        const Post = require('@quelora/common/models/Post');
        if (!clientDoc.postConfig || Object.keys(clientDoc.postConfig).length === 0) {
            clientDoc.postConfig = Post.getDefaultConfig();
        }

        await clientDoc.save();

        const encryptionKey = generateKeyFromString(clientDoc.cid);
        const encryptedClient = {
            cid:         clientDoc.cid,
            description: clientDoc.description,
            siteUrl:     clientDoc.siteUrl,
            config:      encryptJSON(clientDoc.decryptConf(), encryptionKey),
        };

        return res.json({ success: true, client: encryptedClient });
    } catch (error) {
        console.error('[ClientController] quickSetup error:', error);
        next(error);
    }
};

/**
 * PATCH /client/:cid/modules
 *
 * Updates the enabled enterprise modules and/or community plugins for a client.
 *
 * Role rules:
 *  - god  → may update both `enterpriseModules` and `communityPlugins`.
 *  - admin → may update `communityPlugins` only.
 *
 * Body (all fields optional; only the fields present are updated):
 *   enterpriseModules {string[]} — god only. Valid values: VALID_ENTERPRISE_MODULES.
 *   communityPlugins  {string[]} — admin+.  Valid values: VALID_COMMUNITY_PLUGINS.
 */
exports.updateClientModules = async (req, res) => {
    try {
        const { cid }  = req.params;
        const requestor = req.user;
        const { enterpriseModules, communityPlugins } = req.body;

        try {
            await validateCidAccess(requestor.userId, requestor.role, cid);
        } catch (e) {
            return res.status(403).json({ error: 'Access denied to this client.' });
        }

        const client = await Client.findOne({ cid });
        if (!client) return res.status(404).json({ error: 'Client not found.' });

        if (enterpriseModules !== undefined) {
            if (requestor.role !== 'god') {
                return res.status(403).json({ error: 'Only god users can manage enterprise modules.' });
            }
            if (!Array.isArray(enterpriseModules)) {
                return res.status(400).json({ error: 'enterpriseModules must be an array.' });
            }
            const invalid = enterpriseModules.filter(m => !VALID_ENTERPRISE_MODULES.includes(m));
            if (invalid.length > 0) {
                return res.status(400).json({ error: `Invalid enterprise module(s): ${invalid.join(', ')}` });
            }
            client.enterpriseModules = enterpriseModules;
        }

        if (communityPlugins !== undefined) {
            if (!Array.isArray(communityPlugins)) {
                return res.status(400).json({ error: 'communityPlugins must be an array.' });
            }
            const invalid = communityPlugins.filter(p => !VALID_COMMUNITY_PLUGINS.includes(p));
            if (invalid.length > 0) {
                return res.status(400).json({ error: `Invalid community plugin(s): ${invalid.join(', ')}` });
            }
            client.communityPlugins = communityPlugins;
        }

        await client.save();
        await clientConfigService.clearClientConfigCache(cid);

        console.log(
            `[Modules] ${cid} updated by ${requestor.username}` +
            (enterpriseModules ? ` enterprise=[${enterpriseModules.join(',')}]` : '') +
            (communityPlugins  ? ` community=[${communityPlugins.join(',')}]`   : '')
        );

        res.json({
            message:           'Client modules updated successfully.',
            enterpriseModules: client.enterpriseModules,
            communityPlugins:  client.communityPlugins,
        });
    } catch (error) {
        console.error('[ClientController] updateClientModules error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
