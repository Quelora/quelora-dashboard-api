/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/**
 * @fileoverview Dashboard user management controller.
 *
 * Handles profile retrieval, credential management, two-factor setup,
 * system-user CRUD operations, and session client hydration — all with
 * strict role-hierarchy enforcement.
 *
 * @module controllers/userController
 */

const { mongoose } = require('@quelora/common/db');
const User = require('../models/User.js');
const Client = require('@quelora/common/models/Client');
const { validatePasswordStrength } = require('@quelora/common/utils/password.js');
const { saveImageToDisk } = require('@quelora/common/utils/imageHelper.js');
const { decrypt, encryptJSON, generateKeyFromString } = require('@quelora/common/utils/cipher');
const { addEmailJob } = require('@quelora/common/services/emailService');
const verificationTemplate = require('@quelora/common/templates/emails/verificationTemplate');
const { validateCidAccess, getFilterCids } = require('../utils/accessControl');
const { getLocalizedMessage } = require('@quelora/common/services/i18nService');
const { cacheService } = require('@quelora/common/services/cacheService');
const speakeasy = require('speakeasy');
const path = require('path');
const { loginRateLimiter } = require('@quelora/common/middlewares/rateLimiterMiddleware');

const DASHBOARD_LOCALES_PATH = path.join(__dirname, '../locale');

/**
 * Numeric authority levels assigned to each role.
 * Higher values indicate broader access.
 *
 * @type {Object.<string, number>}
 */
const ROLE_LEVELS = {
    god:        100,
    admin:       50,
    editor:      40,
    moderator:   30,
    advertiser:  20,
    analyst:     15,
    user:        10,
};

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/**
 * Returns the authenticated user's profile fields.
 *
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {Promise<void>}
 */
exports.getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('given_name family_name email username picture locale role twoFactorEnabled mustChangePassword accountType enterpriseModules');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Returns the encrypted client list for the authenticated user's current
 * active context, mirroring the payload structure produced at login.
 *
 * This endpoint is the missing piece in the God-mode CID-switch flow.
 * After `/admin/set` updates Redis, the frontend must call this endpoint
 * and replace the `clients` key in storage with the returned array.
 * Components that derive their `cid` query parameter from
 * `loadClientsFromSession()` will then use the correct CID on the
 * next render cycle.
 *
 * Resolution logic:
 *  - **god role**: reads `active_cid:<userId>` from Redis and returns
 *    the single matching client. Returns an empty array when no active
 *    CID has been set yet (triggers the GodClientSelector on the frontend).
 *  - **all other roles**: returns all clients the user is assigned to.
 *
 * Every client object is encrypted with a per-CID AES key
 * (`generateKeyFromString(cid)`) so the payload is safe to store in
 * `localStorage` or `sessionStorage` without exposing plaintext secrets.
 *
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {Promise<void>}
 */
exports.getSessionClients = async (req, res) => {
    try {
        const user = req.user;
        let clientDocs = [];

        if (user.role === 'god') {
            const cacheKey  = `active_cid:${user._id}`;
            const cached    = await cacheService.get(cacheKey);

            if (cached && cached.cid) {
                const activeClient = await Client.findOne({ cid: cached.cid });
                if (activeClient) clientDocs = [activeClient];
            }
        } else {
            clientDocs = await Client.find({ users: user._id });
        }

        const clientsPayload = clientDocs.map((client) => {
            const transportKey = generateKeyFromString(client.cid);

            return {
                cid:         client.cid,
                description: client.description,
                apiUrl:      client.apiUrl,
                siteUrl:     client.siteUrl,
                config:      encryptJSON(client.decryptConf(),         transportKey),
                postConfig:  encryptJSON(client.postConfig || {},      transportKey),
                vapid:       encryptJSON(client.decryptVapid(),        transportKey),
                email:       encryptJSON(client.decryptEmail(),        transportKey),
                turn:              encryptJSON(client.decryptTurn(),             transportKey),
                nostr:             encryptJSON(client.decryptNostr(),            transportKey),
                p2p:               encryptJSON(client.p2p || {},                transportKey),
                resilience:        encryptJSON(client.decryptResilience() || {}, transportKey),
                enterpriseModules: client.enterpriseModules || [],
                communityPlugins:  client.communityPlugins  || [],
            };
        });

        res.json({ clients: clientsPayload });
    } catch (error) {
        console.error('getSessionClients error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Updates the authenticated user's profile fields.
 *
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {Promise<void>}
 */
exports.updateProfile = async (req, res) => {
    try {
        const { given_name, family_name, email, locale, picture } = req.body;
        const userId = req.user._id;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (given_name  !== undefined) user.given_name  = given_name;
        if (family_name !== undefined) user.family_name = family_name;
        if (locale      !== undefined) user.locale      = locale;
        if (email !== undefined && email !== user.email) {
            user.email = email;
        }

        if (picture) {
            try {
                const fileSystemUploadDir = path.join(__dirname, '../public/assets');
                const publicUrlSegment    = '/assets';
                const filename            = `${user.username}_${Date.now()}.webp`;
                const pictureUrl = await saveImageToDisk(
                    picture, filename, fileSystemUploadDir, publicUrlSegment
                );
                if (pictureUrl) {
                    user.picture = pictureUrl;
                }
            } catch (imageError) {
                console.error('Avatar save error:', imageError.message);
                return res.status(400).json({ error: `Failed to save image: ${imageError.message}` });
            }
        }

        const updatedUser = await user.save();
        const userResponse = updatedUser.toObject();
        delete userResponse.password;
        delete userResponse.clients;
        delete userResponse.failedLoginAttempts;
        delete userResponse.lockUntil;

        res.json(userResponse);
    } catch (error) {
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message });
        }
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// ---------------------------------------------------------------------------
// Account security
// ---------------------------------------------------------------------------

/**
 * Manually unlocks a locked user account and resets the rate-limiter for
 * the IP address that triggered the lock.
 *
 * A non-god requestor may only unlock accounts whose role level is strictly
 * lower than their own.
 *
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {Promise<void>}
 */
exports.unlockUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const requestor  = req.user;

        const targetUser = await User.findById(userId);
        if (!targetUser) return res.status(404).json({ error: 'User not found.' });

        const requestorLevel = ROLE_LEVELS[requestor.role] || 0;
        const targetLevel    = ROLE_LEVELS[targetUser.role] || 0;

        if (requestor.role !== 'god' && requestorLevel <= targetLevel) {
            return res.status(403).json({ error: 'Insufficient privileges to unlock this user.' });
        }

        if (targetUser.lastFailedIp) {
            loginRateLimiter.resetKey(targetUser.lastFailedIp);
            console.log(`Rate limit IP ${targetUser.lastFailedIp} reset for user ${targetUser.username}`);
        }

        targetUser.lockUntil           = undefined;
        targetUser.failedLoginAttempts = 0;
        targetUser.lastFailedIp        = undefined;

        await targetUser.save();

        console.log(`User ${targetUser.username} unlocked manually by ${requestor.username}`);
        res.json({ message: 'User account unlocked successfully.' });
    } catch (error) {
        console.error('Unlock user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Changes the authenticated user's password.
 *
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {Promise<void>}
 */
exports.updatePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user._id;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }
        if (currentPassword === newPassword) {
            return res.status(400).json({ error: 'New password must be different from current password' });
        }

        const passwordValidation = validatePasswordStrength(newPassword);
        if (!passwordValidation.valid) {
            return res.status(400).json({ error: passwordValidation.message });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const validPassword = await user.comparePassword(currentPassword);
        if (!validPassword) return res.status(401).json({ error: 'Current password is incorrect' });

        user.password              = newPassword;
        user.mustChangePassword    = false;
        user.failedLoginAttempts   = 0;
        user.lockUntil             = undefined;
        await user.save();

        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error('Password update error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// ---------------------------------------------------------------------------
// Two-factor authentication
// ---------------------------------------------------------------------------

/**
 * Initiates the TOTP two-factor setup flow by generating a new secret.
 *
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {Promise<void>}
 */
exports.setupTwoFactor = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        if (user.twoFactorEnabled) return res.status(400).json({ error: '2FA is already enabled.' });

        const secret         = speakeasy.generateSecret({ name: `Quelora (${user.username})` });
        user.twoFactorSecret = secret.base32;
        await user.save();

        res.json({ otpauth_url: secret.otpauth_url, base32: secret.base32 });
    } catch (error) {
        console.error('2FA setup error:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

/**
 * Verifies a TOTP code and enables two-factor authentication on the account.
 *
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {Promise<void>}
 */
exports.verifyTwoFactorSetup = async (req, res) => {
    try {
        const { totpToken } = req.body;
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.twoFactorEnabled) return res.status(400).json({ error: '2FA is already enabled' });
        if (!user.twoFactorSecret) return res.status(400).json({ error: '2FA setup was not initiated.' });

        const decryptedSecret = decrypt(user.twoFactorSecret, process.env.ENCRYPTION_KEY);
        const isVerified = speakeasy.totp.verify({
            secret:   decryptedSecret,
            encoding: 'base32',
            token:    totpToken,
            window:   1,
        });

        if (isVerified) {
            user.twoFactorEnabled = true;
            await user.save();
            res.json({ message: '2FA enabled successfully' });
        } else {
            res.status(400).json({ error: 'Invalid token.' });
        }
    } catch (error) {
        console.error('2FA verification error:', error);
        if (error.message && error.message.includes('bad decrypt')) {
            return res.status(500).json({ error: 'Decryption failed.' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Disables two-factor authentication after re-confirming the account password.
 *
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {Promise<void>}
 */
exports.disableTwoFactor = async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ error: 'Password is required.' });

        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const validPassword = await user.comparePassword(password);
        if (!validPassword) return res.status(401).json({ error: 'Invalid password.' });

        user.twoFactorEnabled = false;
        user.twoFactorSecret  = undefined;
        await user.save();

        res.json({ message: '2FA disabled successfully.' });
    } catch (error) {
        console.error('2FA disable error:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

// ---------------------------------------------------------------------------
// System user management
// ---------------------------------------------------------------------------

/**
 * Returns the list of users visible to the authenticated requestor.
 *
 * ### Visibility rules
 *
 * **God role**: sees all users in the system scoped to their active CID context.
 * The result is still subject to the role-level ceiling below.
 *
 * **All other roles**: the visible set is derived from the `users` array of
 * every Client document the requestor has access to. A **role-level ceiling**
 * ensures only accounts whose role level is strictly lower than the requestor's
 * own level are returned, preventing an admin from ever seeing other admins or
 * god users.
 *
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {Promise<void>}
 */
exports.getManagedUsers = async (req, res) => {
    try {
        const currentUser    = req.user;
        const { showDeleted } = req.query;

        const allowedCids = await getFilterCids(currentUser._id, currentUser.role, null);

        if (!allowedCids || allowedCids.length === 0) {
            return res.json([]);
        }

        let userIds = new Set();

        if (currentUser.role === 'god') {
            const allUsers = await User.find({}).select('_id');
            allUsers.forEach((u) => userIds.add(u._id.toString()));
        } else {
            const myClients = await Client.find({ cid: { $in: allowedCids } })
                .select('users')
                .lean();

            myClients.reduce((acc, client) => {
                if (client.users && Array.isArray(client.users)) {
                    client.users.forEach((id) => acc.add(id.toString()));
                }
                return acc;
            }, userIds);
        }

        const requestorLevel = ROLE_LEVELS[currentUser.role] || 0;

        const query = { _id: { $in: Array.from(userIds) } };

        if (String(showDeleted) !== 'true') {
            query.isDeleted = { $ne: true };
        }

        if (currentUser.role !== 'god') {
            const visibleRoles = Object.entries(ROLE_LEVELS)
                .filter(([, level]) => level < requestorLevel)
                .map(([role]) => role);

            query.role = { $in: visibleRoles };
        }

        const users = await User.find(query)
            .select('-password -twoFactorSecret -__v')
            .sort({ isDeleted: 1, createdAt: -1 })
            .lean();

        const usersWithClients = await Promise.all(
            users.map(async (u) => {
                const assignedClients = await Client.find({ users: u._id })
                    .select('cid description')
                    .lean();
                return { ...u, clients: assignedClients };
            })
        );

        res.json(usersWithClients);
    } catch (error) {
        console.error('Get managed users error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Creates a new system user and optionally sends a welcome email.
 *
 * A requestor may not create an account with a role level equal to or higher
 * than their own (god excluded from this restriction).
 *
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {Promise<void>}
 */
exports.createUser = async (req, res) => {
    try {
        const {
            username, password, given_name, family_name,
            email, role, clientIds, locale, notifyUser,
        } = req.body;

        const creator      = req.user;
        const creatorLevel = ROLE_LEVELS[creator.role] || 0;
        const newRoleLevel = ROLE_LEVELS[role];

        if (!newRoleLevel) {
            return res.status(400).json({ error: 'Invalid role specified.' });
        }

        if (creatorLevel < newRoleLevel) {
            return res.status(403).json({ error: 'Insufficient privileges.' });
        }

        if (!Array.isArray(clientIds) || clientIds.length === 0) {
            if (creator.role !== 'god' && role !== 'god') {
                return res.status(400).json({ error: 'At least one CID is required.' });
            }
        }

        if (clientIds && clientIds.length > 0) {
            try {
                await validateCidAccess(creator._id, creator.role, clientIds);
            } catch (accessError) {
                console.warn(`Security Alert: User ${creator.username} tried to assign unauthorized CIDs.`);
                return res.status(403).json({ error: 'Access denied to one or more clients.' });
            }
        }

        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.status(409).json({ error: 'Username or Email already exists.' });
        }

        const userLocale = locale || 'en';

        const newUser = await User.create({
            username,
            password,
            given_name,
            family_name,
            email,
            role,
            locale:             userLocale,
            twoFactorEnabled:   false,
            mustChangePassword: true,
        });

        if (clientIds && clientIds.length > 0) {
            await Client.updateMany(
                { cid: { $in: clientIds } },
                { $addToSet: { users: newUser._id } }
            );
        }

        if (notifyUser && email) {
            try {
                const emailCid     = clientIds && clientIds.length > 0 ? clientIds[0] : null;
                const dashboardUrl = process.env.DASHBOARD_URL || 'https://dashboard.quelora.org';

                const [
                    subject, title, greeting, intro,
                    usernameLabel, securityNotice, loginInstruction, actionBtnText,
                ] = await Promise.all([
                    getLocalizedMessage('email.welcome_console.subject',        userLocale, {},                               DASHBOARD_LOCALES_PATH),
                    getLocalizedMessage('email.welcome_console.title',          userLocale, {},                               DASHBOARD_LOCALES_PATH),
                    getLocalizedMessage('email.welcome_console.greeting',       userLocale, { name: given_name || username }, DASHBOARD_LOCALES_PATH),
                    getLocalizedMessage('email.welcome_console.intro',          userLocale, {},                               DASHBOARD_LOCALES_PATH),
                    getLocalizedMessage('email.welcome_console.username_label', userLocale, { username },                    DASHBOARD_LOCALES_PATH),
                    getLocalizedMessage('email.welcome_console.security_notice', userLocale, {},                              DASHBOARD_LOCALES_PATH),
                    getLocalizedMessage('email.welcome_console.login_instruction', userLocale, {},                            DASHBOARD_LOCALES_PATH),
                    getLocalizedMessage('email.welcome_console.action_btn',     userLocale, {},                               DASHBOARD_LOCALES_PATH),
                ]);

                const messageBody = `
                    <h2>${title}</h2>
                    <p>${greeting}</p>
                    <p>${intro}</p>
                    <p><strong>${usernameLabel}</strong></p>
                    <p style="background-color:#fff3cd;padding:10px;border-radius:4px;color:#856404;font-size:13px;">
                        <strong>${securityNotice}</strong>
                    </p>
                    <p>${loginInstruction}</p>
                `;

                const emailHtml = verificationTemplate({
                    title:      subject,
                    body:       messageBody,
                    actionUrl:  dashboardUrl,
                    actionText: actionBtnText,
                });

                await addEmailJob(emailCid, null, subject, emailHtml, email);
            } catch (emailError) {
                console.error('Failed to send welcome email:', emailError);
            }
        }

        const responseUser = newUser.toObject();
        delete responseUser.password;

        console.log(`User created: ${username} by ${creator.username}`);
        res.status(201).json(responseUser);
    } catch (error) {
        console.error('Create user error:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: 'Internal server error during user creation.' });
    }
};

/**
 * Resets the password of a target user, forcing a password change on next login.
 *
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {Promise<void>}
 */
exports.resetUserPassword = async (req, res) => {
    try {
        const { userId }     = req.params;
        const { newPassword } = req.body;
        const requestor      = req.user;

        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters.' });
        }

        const targetUser = await User.findById(userId);
        if (!targetUser) return res.status(404).json({ error: 'User not found.' });

        const requestorLevel = ROLE_LEVELS[requestor.role] || 0;
        const targetLevel    = ROLE_LEVELS[targetUser.role] || 0;

        if (requestor.role !== 'god' && requestorLevel <= targetLevel) {
            return res.status(403).json({ error: 'Insufficient privileges to modify this user.' });
        }

        targetUser.password            = newPassword;
        targetUser.mustChangePassword  = true;
        targetUser.lockUntil           = undefined;
        targetUser.failedLoginAttempts = 0;

        await targetUser.save();

        console.log(`Password reset for user ${targetUser.username} by ${requestor.username}`);
        res.json({ message: 'Password reset successfully.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Soft-deletes a system user by setting `isDeleted = true`.
 *
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {Promise<void>}
 */
exports.deleteSystemUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const requestor  = req.user;

        const targetUser = await User.findById(userId);
        if (!targetUser) return res.status(404).json({ error: 'User not found.' });

        const requestorLevel = ROLE_LEVELS[requestor.role] || 0;
        const targetLevel    = ROLE_LEVELS[targetUser.role] || 0;

        if (requestor.role !== 'god' && requestorLevel <= targetLevel) {
            return res.status(403).json({ error: 'Insufficient privileges to delete this user.' });
        }

        targetUser.isDeleted = true;
        await targetUser.save();

        console.log(`User ${targetUser.username} logically deleted by ${requestor.username}`);
        res.json({ message: 'User deleted successfully.' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Restores a soft-deleted system user by setting `isDeleted = false`.
 *
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {Promise<void>}
 */
exports.restoreSystemUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const requestor  = req.user;

        const targetUser = await User.findById(userId);
        if (!targetUser) return res.status(404).json({ error: 'User not found.' });

        const requestorLevel = ROLE_LEVELS[requestor.role] || 0;
        const targetLevel    = ROLE_LEVELS[targetUser.role] || 0;

        if (requestor.role !== 'god' && requestorLevel <= targetLevel) {
            return res.status(403).json({ error: 'Insufficient privileges to restore this user.' });
        }

        targetUser.isDeleted = false;
        await targetUser.save();

        console.log(`User ${targetUser.username} restored by ${requestor.username}`);
        res.json({ message: 'User restored successfully.' });
    } catch (error) {
        console.error('Restore user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * PATCH /user/:userId
 *
 * Allows god and admin roles to edit staff user details.
 * - God: may edit any user.
 * - Admin: may only edit users belonging to one of their CIDs,
 *          and cannot assign a role equal to or higher than their own.
 *
 * Body (all optional):
 *   given_name  {string}   - First name
 *   family_name {string}   - Last name
 *   email       {string}   - Email address
 *   locale      {string}   - Preferred language code
 *   role        {string}   - New role (must be below requestor's level for non-god)
 *   clientIds   {string[]} - New set of assigned CIDs (requestor must have access to all)
 */
exports.updateSystemUser = async (req, res) => {
    try {
        const { userId }  = req.params;
        const requestor   = req.user;

        // Prevent self-edit via this endpoint
        if (userId === requestor._id.toString()) {
            return res.status(400).json({ error: 'Use the profile endpoint to update your own account.' });
        }

        const targetUser = await User.findById(userId);
        if (!targetUser) return res.status(404).json({ error: 'User not found.' });

        const requestorLevel = ROLE_LEVELS[requestor.role] || 0;
        const targetLevel    = ROLE_LEVELS[targetUser.role] || 0;

        // Non-god cannot manage users at or above their own level
        if (requestor.role !== 'god' && requestorLevel <= targetLevel) {
            return res.status(403).json({ error: 'Insufficient privileges to edit this user.' });
        }

        // Admin must have access to at least one of the target user's CIDs
        if (requestor.role !== 'god') {
            const allowedCids   = await getFilterCids(requestor._id, requestor.role);
            const targetClients = await Client.find({ users: targetUser._id }).select('cid').lean();
            const targetCids    = targetClients.map(c => c.cid);
            const hasAccess     = targetCids.some(cid => allowedCids.includes(cid));
            if (!hasAccess) {
                return res.status(403).json({ error: 'You do not have access to this user.' });
            }
        }

        const { given_name, family_name, email, locale, role, clientIds } = req.body;

        // Role change
        if (role !== undefined) {
            const newRoleLevel = ROLE_LEVELS[role];
            if (!newRoleLevel) return res.status(400).json({ error: 'Invalid role specified.' });
            if (requestor.role !== 'god' && newRoleLevel >= requestorLevel) {
                return res.status(403).json({ error: 'Cannot assign a role equal to or higher than your own.' });
            }
            targetUser.role = role;
        }

        // Basic fields
        if (given_name  !== undefined) targetUser.given_name  = given_name;
        if (family_name !== undefined) targetUser.family_name = family_name;
        if (locale      !== undefined) targetUser.locale      = locale;
        if (email !== undefined && email !== targetUser.email) targetUser.email = email;

        // Client assignment update
        if (clientIds !== undefined) {
            if (clientIds.length > 0) {
                try {
                    await validateCidAccess(requestor._id, requestor.role, clientIds);
                } catch {
                    return res.status(403).json({ error: 'Access denied to one or more clients.' });
                }
            }

            const currentClients = await Client.find({ users: targetUser._id }).select('cid').lean();
            const currentCids    = currentClients.map(c => c.cid);

            // Only remove from CIDs the requestor has access to (prevent stripping unmanaged CIDs)
            const allowedCids = requestor.role === 'god'
                ? currentCids
                : await getFilterCids(requestor._id, requestor.role);

            const toRemove = currentCids.filter(cid => !clientIds.includes(cid) && allowedCids.includes(cid));
            const toAdd    = clientIds.filter(cid => !currentCids.includes(cid));

            if (toRemove.length > 0) {
                await Client.updateMany({ cid: { $in: toRemove } }, { $pull: { users: targetUser._id } });
            }
            if (toAdd.length > 0) {
                await Client.updateMany({ cid: { $in: toAdd } }, { $addToSet: { users: targetUser._id } });
            }
        }

        await targetUser.save();

        const updated = targetUser.toObject();
        delete updated.password;
        delete updated.twoFactorSecret;

        const assignedClients = await Client.find({ users: targetUser._id }).select('cid description').lean();

        console.log(`User ${targetUser.username} updated by ${requestor.username}`);
        return res.json({ ...updated, clients: assignedClients });
    } catch (error) {
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message });
        }
        console.error('Update system user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * PATCH /user/:userId/enterprise
 *
 * Updates the enterprise plan attributes of a system user.
 * Only accessible by god-role users.
 *
 * Body:
 *   accountType       {string}   — 'community' | 'enterprise'
 *   enterpriseModules {string[]} — list of enabled module identifiers
 *
 * Valid module identifiers:
 *   surveys, gamification, advertising, network, resilience, push, liveMode
 */
const VALID_ENTERPRISE_MODULES = [
    'surveys', 'gamification', 'advertising',
    'network', 'resilience', 'push', 'liveMode',
];

exports.updateUserEnterprise = async (req, res) => {
    try {
        const { userId }   = req.params;
        const requestor    = req.user;
        const { accountType, enterpriseModules } = req.body;

        // Only god users may assign enterprise plans.
        if (requestor.role !== 'god') {
            return res.status(403).json({ error: 'Only god users can manage enterprise plans.' });
        }

        // Validate accountType.
        if (!['community', 'enterprise'].includes(accountType)) {
            return res.status(400).json({ error: 'Invalid accountType. Must be "community" or "enterprise".' });
        }

        // Validate modules when enterprise.
        if (accountType === 'enterprise') {
            if (!Array.isArray(enterpriseModules)) {
                return res.status(400).json({ error: 'enterpriseModules must be an array.' });
            }
            const invalid = enterpriseModules.filter(m => !VALID_ENTERPRISE_MODULES.includes(m));
            if (invalid.length > 0) {
                return res.status(400).json({ error: `Invalid module(s): ${invalid.join(', ')}` });
            }
        }

        const targetUser = await User.findById(userId);
        if (!targetUser) return res.status(404).json({ error: 'User not found.' });

        targetUser.accountType       = accountType;
        targetUser.enterpriseModules = accountType === 'enterprise' ? enterpriseModules : [];
        await targetUser.save();

        console.log(
            `Enterprise plan for ${targetUser.username} set to "${accountType}"` +
            (accountType === 'enterprise' ? ` [${enterpriseModules.join(', ')}]` : '') +
            ` by ${requestor.username}`
        );

        res.json({
            message:           'Enterprise plan updated successfully.',
            accountType:       targetUser.accountType,
            enterpriseModules: targetUser.enterpriseModules,
        });
    } catch (error) {
        console.error('Update enterprise plan error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};