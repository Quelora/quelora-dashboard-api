/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./src/models/User.js
const { mongoose } = require('@quelora/common/db');

if (mongoose.models.User) {
    delete mongoose.models.User;
}

const bcrypt = require('bcrypt');
const { encrypt, decrypt, encryptJSON, generateKeyFromString } = require('@quelora/common/utils/cipher');
const createSchemas = require('./UserSchema');
const Client = require('@quelora/common/models/Client');
const { cacheService } = require('@quelora/common/services/cacheService'); 

const { userSchema } = createSchemas();

const MAX_ATTEMPTS = 10;
const LOCK_TIME = 15 * 60 * 1000;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

/**
 * Post-findOne hook to populate associated client configurations dynamically.
 * Resolves the client payload directly into the user document upon retrieval.
 *
 * @param {Object} doc - The returned Mongoose document.
 * @param {Function} next - Mongoose next middleware function.
 */
userSchema.post('findOne', async function(doc, next) {
    if (!doc) return next();

    const options = this.getOptions();
    if (options.loadClients === false) return next();

    try {
        let clientDocs = [];

        if (doc.role === 'god') {
            const cacheKey = `active_cid:${doc._id}`;
            const cachedData = await cacheService.get(cacheKey);
            if (cachedData && cachedData.cid) {
                const activeClient = await Client.findOne({ cid: cachedData.cid });
                if (activeClient) {
                    clientDocs = [activeClient];
                }
            }
        } else {
            clientDocs = await Client.find({ users: doc._id });
        }

        const clientsPayload = clientDocs.map(client => {
            return {
                cid:            client.cid,
                description:    client.description,
                apiUrl:         client.apiUrl,
                config:         encryptJSON(client.decryptConf(),   generateKeyFromString(client.cid)),
                postConfig:     encryptJSON(client.postConfig,      generateKeyFromString(client.cid)),
                vapid:          encryptJSON(client.decryptVapid(),  generateKeyFromString(client.cid)),
                email:          encryptJSON(client.decryptEmail(),  generateKeyFromString(client.cid)),
                turn:           encryptJSON(client.decryptTurn(),   generateKeyFromString(client.cid)),
                nostr:          encryptJSON(client.decryptNostr(),  generateKeyFromString(client.cid)),
                p2p:            encryptJSON(client.p2p || {},       generateKeyFromString(client.cid)),
                resilience:     encryptJSON(client.resilience || {},generateKeyFromString(client.cid)),
            };
        });

        if (doc._doc) {
            doc._doc.clients = clientsPayload;
        } else {
            doc.clients = clientsPayload;
        }

    } catch (error) {
        console.error('Error injecting clients into User model:', error);
    }
    
    next();
});

/**
 * Generates a globally unique Client ID based on timestamp and randomness.
 *
 * @param {number} [maxAttempts=5] - Maximum number of retries for uniqueness.
 * @returns {Promise<string>} The generated unique Client ID.
 * @throws {Error} If it fails to generate a unique CID after maximum attempts.
 */
userSchema.statics.generateUniqueCID = async function(maxAttempts = 5) {
    let attempts = 0;
    while (attempts < maxAttempts) {
        attempts++;
        const timestampPart = Date.now().toString(36).toUpperCase();
        const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
        const candidateCID = `QU-${timestampPart}-${randomPart}`;
        const exists = await Client.exists({ cid: candidateCID });

        if (!exists) {
            return candidateCID;
        }
    }
    throw new Error(`Failed to generate unique CID after ${maxAttempts} attempts`);
};

/**
 * Pre-save hook to hash passwords and encrypt 2FA secrets.
 * Also synchronizes the updatedAt timestamp.
 *
 * @param {Function} next - Mongoose next middleware function.
 */
userSchema.pre('save', async function(next) {
    if (this.isModified('password')) {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
    }

    if (this.isModified('twoFactorSecret') && this.twoFactorSecret) {
        try {
            this.twoFactorSecret = encrypt(this.twoFactorSecret, process.env.ENCRYPTION_KEY);
        } catch (error) {
            return next(error);
        }
    }

    this.updatedAt = new Date();
    next();
});

/**
 * Evaluates whether the user account is currently locked due to too many attempts.
 *
 * @returns {boolean} True if the account is locked, false otherwise.
 */
userSchema.methods.isLocked = function() {
    return this.lockUntil && this.lockUntil > Date.now();
};

/**
 * Registers a failed login attempt and locks the account if the threshold is met.
 *
 * @param {string} clientIp - The IP address of the incoming request.
 * @returns {Promise<boolean>} True only when the account was just locked on this call, false otherwise.
 */
userSchema.methods.incrementLoginAttempts = async function(clientIp) {
    this.failedLoginAttempts += 1;
    if (clientIp) {
        this.lastFailedIp = clientIp;
    }
    const justLocked = this.failedLoginAttempts >= MAX_ATTEMPTS;
    if (justLocked) {
        this.lockUntil = Date.now() + LOCK_TIME;
    }
    await this.save();
    return justLocked;
};

/**
 * Compares an incoming plain-text password against the hashed footprint.
 *
 * @param {string} candidatePassword - The plain-text password attempt.
 * @returns {Promise<boolean>} True if the password matches, false otherwise.
 */
userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

/**
 * Decrypts systemic encrypted settings natively from a client configuration payload.
 *
 * @param {Object} conf - The encrypted configuration object to decrypt.
 * @returns {Object} The deeply decrypted configuration object.
 */
userSchema.methods.decryptConf = function(conf) {
    const decryptedConf = JSON.parse(JSON.stringify(conf));
    
    if (decryptedConf.login?.providerDetails) {
        for (const provider of Object.values(decryptedConf.login.providerDetails)) {
            if (provider.clientSecretCipher) {
                provider.clientSecret = decrypt(provider.clientSecretCipher, ENCRYPTION_KEY);
                provider.clientSecretCipher = undefined;
            }
        }
    }
    
    const modulesToDecrypt = ['moderation', 'toxicity', 'translation', 'geolocation'];
    for (const moduleName of modulesToDecrypt) {
        if (decryptedConf[moduleName]?.apiKeyCipher) {
            decryptedConf[moduleName].apiKey = decrypt(decryptedConf[moduleName].apiKeyCipher, ENCRYPTION_KEY);
            decryptedConf[moduleName].apiKeyCipher = undefined;
        }
    }

    if (decryptedConf.login?.jwtSecretCipher) {
        decryptedConf.login.jwtSecret = decrypt(decryptedConf.login.jwtSecretCipher, ENCRYPTION_KEY);
        decryptedConf.login.jwtSecretCipher = undefined;
    }

    if (decryptedConf.captcha?.secretKeyCipher) {
        decryptedConf.captcha.secretKey = decrypt(decryptedConf.captcha.secretKeyCipher, ENCRYPTION_KEY);
        decryptedConf.captcha.secretKeyCipher = undefined;
    }
    if (decryptedConf.captcha?.credentialsJsonCipher) {
        decryptedConf.captcha.credentialsJson = decrypt(decryptedConf.captcha.credentialsJsonCipher, ENCRYPTION_KEY);
        decryptedConf.captcha.credentialsJsonCipher = undefined;
    }
    
    return decryptedConf;
};

const UserModel = mongoose.model('User', userSchema);
UserModel.MAX_ATTEMPTS = MAX_ATTEMPTS;
module.exports = UserModel;