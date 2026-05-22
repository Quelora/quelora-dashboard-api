/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: packages/quelora-dashboard-api/controllers/authController.js
const User = require('../models/User');
const Client = require('@quelora/common/models/Client');
const { addEmailJob } = require('@quelora/common/services/emailService');
const { encryptJSON, generateKeyFromString, decrypt } = require('@quelora/common/utils/cipher');
const { renewAdminToken } = require('@quelora/common/services/authService');
const { getLocalizedMessage } = require('@quelora/common/services/i18nService');
const notificationTemplate = require('@quelora/common/templates/emails/notificationTemplate');
const verificationTemplate = require('@quelora/common/templates/emails/verificationTemplate');
const { cacheService } = require('@quelora/common/services/cacheService');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const crypto = require('crypto');
const path = require('path');

const svgCaptcha = require('svg-captcha');

const DASHBOARD_LOCALES_PATH = path.join(__dirname, '../locale');
const OTP_TTL_S  = 15 * 60; // 15 minutes in seconds (for Redis)
const MAX_VERIFICATION_ATTEMPTS = 5;

// Threshold from which remaining-attempts warnings are surfaced to the client.
const REMAINING_WARNING_THRESHOLD = 5;

// Progressive server-side delay per attempt (index = failedAttempts before this call).
// A human never notices 500 ms; a credential-stuffing bot accumulates them quickly.
const ATTEMPT_DELAYS_MS = [0, 0, 500, 1000, 2000, 4000, 8000, 8000, 8000, 8000];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const pendingKey = (email) => `pending_registration:${email}`;

async function getSuccessfulLoginPayload(user, clientIp) {
    const clientDocs = await Client.find({ users: user._id });

    const clientsPayload = clientDocs.map(client => {
        const transportKey = generateKeyFromString(client.cid);

        return {
            cid:         client.cid,
            description: client.description,
            apiUrl:      client.apiUrl,
            siteUrl:     client.siteUrl,
            config:      encryptJSON(client.decryptConf(),      transportKey),
            postConfig:  encryptJSON(client.postConfig,         transportKey),
            vapid:       encryptJSON(client.decryptVapid(),     transportKey),
            email:       encryptJSON(client.decryptEmail(),     transportKey),
            turn:              encryptJSON(client.decryptTurn(),              transportKey),
            nostr:             encryptJSON(client.decryptNostr(),             transportKey),
            p2p:               encryptJSON(client.p2p || {},                 transportKey),
            resilience:        encryptJSON(client.decryptResilience() || {},  transportKey),
            enterpriseModules: client.enterpriseModules || [],
            communityPlugins:  client.communityPlugins  || [],
        };
    });

    // ARCHITECTURAL UPDATE:
    // Dashboard users and God mode operate above the tenant level.
    // They are signed with the global environment secrets, ensuring they can
    // manage multiple clients or assume any CID later.
    const tokenPayload = {
        userId: user._id.toString(),
        author: user.username,
        ip: clientIp,
        email: user.email,
        role: user.role
    };

    const isPrivileged = user.role === 'admin' || user.role === 'god';
    const secret    = isPrivileged ? process.env.JWT_ADMIN_SECRET : process.env.JWT_SECRET;
    const expiresIn = isPrivileged ? process.env.JWT_ADMIN_TTL    : process.env.JWT_TTL;

    const token = jwt.sign(tokenPayload, secret, { expiresIn });

    const userProfile = {
        _id: user._id,
        username: user.username,
        given_name: user.given_name,
        family_name: user.family_name,
        email: user.email,
        picture: user.picture,
        locale: user.locale,
        role: user.role,
        twoFactorEnabled: user.twoFactorEnabled,
        accountType: user.accountType || 'community',
        enterpriseModules: Array.isArray(user.enterpriseModules) ? user.enterpriseModules : [],
    };

    return {
        token,
        expiresIn,
        role: user.role,
        user: userProfile,
        clients: clientsPayload
    };
}

exports.generateToken = async (req, res) => {
    try {
        const { username, password } = req.body;
        const clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required.' });
        }

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        if (user.isLocked()) {
            const retryAfterMs = Math.max(0, user.lockUntil - Date.now());
            return res.status(429).json({
                error: 'Too many login attempts.',
                retryAfter: Math.ceil(retryAfterMs / 1000),
            });
        }

        const validPassword = await user.comparePassword(password);
        if (!validPassword) {
            const attemptsBefore = user.failedLoginAttempts;
            const isJustLocked = await user.incrementLoginAttempts(clientIp);

            const delayIndex = Math.min(attemptsBefore, ATTEMPT_DELAYS_MS.length - 1);
            if (ATTEMPT_DELAYS_MS[delayIndex] > 0) await sleep(ATTEMPT_DELAYS_MS[delayIndex]);

            if (isJustLocked) {
                sendLockNotification(user, clientIp).catch(err =>
                    console.error('Error sending lock email async:', err)
                );
                const retryAfterMs = Math.max(0, user.lockUntil - Date.now());
                return res.status(429).json({
                    error: 'Too many login attempts.',
                    retryAfter: Math.ceil(retryAfterMs / 1000),
                });
            }

            const responseBody = { error: 'Invalid credentials.' };
            const remainingAttempts = User.MAX_ATTEMPTS - user.failedLoginAttempts;
            if (remainingAttempts <= REMAINING_WARNING_THRESHOLD) {
                responseBody.remainingAttempts = remainingAttempts;
            }
            return res.status(401).json(responseBody);
        }

        if (user.failedLoginAttempts > 0 || user.lockUntil) {
            user.failedLoginAttempts = 0;
            user.lockUntil = undefined;
            user.lastFailedIp = undefined;
            await user.save();
        }

        if (user.twoFactorEnabled && user.twoFactorSecret) {
            const tempTokenPayload = {
                userId: user._id,
                type: '2FA_PRE_AUTH'
            };

            const tempToken = jwt.sign(
                tempTokenPayload,
                process.env.JWT_SECRET,
                { expiresIn: '5m' }
            );

            return res.json({
                requires2FA: true,
                tempToken: tempToken
            });
        } else {
            const payload = await getSuccessfulLoginPayload(user, clientIp);
            return res.json(payload);
        }
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

exports.renewAdminToken = async (req, res) => {
    try {
        const { expiredToken } = req.body;
        const clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

        if (!expiredToken) {
            return res.status(400).json({ error: 'Expired token is required' });
        }

        const newToken = renewAdminToken(expiredToken, clientIp);

        res.json({
            token: newToken,
            expiresIn: process.env.JWT_ADMIN_TTL,
            role: 'admin'
        });

    } catch (error) {
        console.error('Token renewal error:', error);
        res.status(401).json({ error: error.message });
    }
};

exports.verifyTwoFactor = async (req, res) => {
    try {
        const { totpToken } = req.body;
        const authHeader = req.headers.authorization;
        const tempToken = authHeader && authHeader.split(' ')[1];

        if (!totpToken || !tempToken) {
            return res.status(400).json({ error: '2FA code and temporary token are required.' });
        }

        let payload;
        try {
            payload = jwt.verify(tempToken, process.env.JWT_SECRET);
            if (payload.type !== '2FA_PRE_AUTH') {
                throw new Error('Invalid token type.');
            }
        } catch (err) {
            return res.status(401).json({ error: 'Invalid or expired 2FA token. Please log in again.' });
        }

        const user = await User.findById(payload.userId);
        if (!user || !user.twoFactorSecret) {
            return res.status(401).json({ error: 'User not found or 2FA not configured.' });
        }

        const decryptedSecret = decrypt(user.twoFactorSecret, process.env.ENCRYPTION_KEY);

        const isVerified = speakeasy.totp.verify({
            secret: decryptedSecret,
            encoding: 'base32',
            token: totpToken,
            window: 1
        });

        if (isVerified) {
            const clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
            const loginPayload = await getSuccessfulLoginPayload(user, clientIp);
            console.log(loginPayload);
            return res.json(loginPayload);
        } else {
            return res.status(400).json({ error: 'Invalid 2FA code.' });
        }
    } catch (error) {
        console.error('2FA verification error:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

async function sendLockNotification(user, clientIp) {
    const clientDocs = await Client.find({ users: user._id });
    const cid = clientDocs?.[0]?.cid;
    if (!user.email || !cid) return;

    try {
        const locale = user.locale || 'en';
        const dashboardUrl = process.env.DASHBOARD_URL || process.env.FRONTEND_URL || '#';

        const [
            subject,
            title,
            message,
            actionBtnText,
        ] = await Promise.all([
            getLocalizedMessage('security.account_locked_title', locale),
            getLocalizedMessage('security.account_locked_title', locale),
            getLocalizedMessage('security.account_locked_message', locale, { name: user.username, ip: clientIp }),
            getLocalizedMessage('email.default_action', locale),
        ]);

        const messageBody = `
            <h2>${title}</h2>
            <p>${message}</p>
            <div style="background-color: #ffebee; padding: 15px; border-radius: 6px; color: #c62828; font-size: 14px; margin: 20px 0; border: 1px solid #ef9a9a;">
                <strong>IP: ${clientIp}</strong>
            </div>
        `;

        const emailHtml = notificationTemplate({
            title: subject,
            body: messageBody,
            actionUrl: dashboardUrl,
            actionText: actionBtnText,
            footerText: '', // Placeholder si faltaba inyectar en tu script original
            rightsText: '',
            fallbackText: '',
            language: locale
        });

        await addEmailJob(cid, null, subject, emailHtml, user.email, {
            type: 'security_alert',
            force: true
        });
    } catch (error) {
        console.error('Error sending lock notification:', error);
    }
}

// ---------------------------------------------------------------------------
// Registration helpers
// ---------------------------------------------------------------------------

function generateOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

// pending: { given_name, email, otp, locale }
async function sendVerificationEmail(pending) {
    const locale = pending.locale || 'en';
    const subject    = await getLocalizedMessage('email.email_verification.subject',    locale, {}, DASHBOARD_LOCALES_PATH);
    const title      = await getLocalizedMessage('email.email_verification.title',      locale, {}, DASHBOARD_LOCALES_PATH);
    const greeting   = await getLocalizedMessage('email.email_verification.greeting',   locale, { name: pending.given_name }, DASHBOARD_LOCALES_PATH);
    const intro      = await getLocalizedMessage('email.email_verification.intro',      locale, {}, DASHBOARD_LOCALES_PATH);
    const codeLabel  = await getLocalizedMessage('email.email_verification.code_label', locale, { code: pending.otp }, DASHBOARD_LOCALES_PATH);
    const codeExpiry = await getLocalizedMessage('email.email_verification.code_expiry',locale, {}, DASHBOARD_LOCALES_PATH);
    const ignore     = await getLocalizedMessage('email.email_verification.ignore',     locale, {}, DASHBOARD_LOCALES_PATH);

    const body = `
        <h2>${title}</h2>
        <p>${greeting}</p>
        <p>${intro}</p>
        <p style="font-size:2rem;font-weight:700;letter-spacing:0.4rem;text-align:center;padding:16px 0;">${pending.otp}</p>
        <p style="font-size:0.85rem;color:#666;">${codeLabel}</p>
        <p style="font-size:0.85rem;color:#666;">${codeExpiry}</p>
        <p style="font-size:0.8rem;color:#999;">${ignore}</p>
    `;

    const emailHtml = verificationTemplate({ title: subject, body, actionUrl: '', actionText: '' });
    await addEmailJob('SYSTEM', null, subject, emailHtml, pending.email, { force: true });
}

// ---------------------------------------------------------------------------
// POST /auth/register
// No DB record is created until the email is verified (OTP stored in Redis).
// ---------------------------------------------------------------------------

exports.register = async (req, res) => {
    try {
        const { firstName, lastName, email, password, locale } = req.body;

        if (!firstName || !email || !password) {
            return res.status(400).json({ error: 'firstName, email and password are required.' });
        }

        const emailLower = email.trim().toLowerCase();

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(emailLower)) {
            return res.status(400).json({ error: 'Invalid email address.' });
        }

        const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;
        if (!strongPassword.test(password)) {
            return res.status(400).json({ error: 'Password does not meet security requirements.' });
        }

        // Reject if a confirmed account already exists
        const existing = await User.findOne({ $or: [{ email: emailLower }, { username: emailLower }] })
            .setOptions({ loadClients: false });
        if (existing) {
            return res.status(409).json({ error: 'An account with this email already exists.' });
        }

        const otp = generateOtp();

        const pending = {
            given_name:  firstName.trim(),
            family_name: lastName ? lastName.trim() : '',
            email:       emailLower,
            password,               // plain — hashed on user creation after OTP confirm
            locale:      locale || 'en',
            otp,
            attempts:    0,
        };

        await cacheService.set(pendingKey(emailLower), pending, OTP_TTL_S);

        await sendVerificationEmail(pending).catch(err =>
            console.error('Failed to send verification email:', err)
        );

        return res.status(201).json({ message: 'Registration successful. Please verify your email.' });
    } catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({ error: 'Internal server error during registration.' });
    }
};

// ---------------------------------------------------------------------------
// POST /auth/verify-email
// ---------------------------------------------------------------------------

exports.verifyEmail = async (req, res) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) {
            return res.status(400).json({ error: 'email and code are required.' });
        }

        const emailLower = email.trim().toLowerCase();

        const pending = await cacheService.get(pendingKey(emailLower));
        if (!pending) {
            return res.status(404).json({ error: 'No pending registration found. Please register again.' });
        }

        if (pending.attempts >= MAX_VERIFICATION_ATTEMPTS) {
            return res.status(429).json({ error: 'Too many attempts. Please register again.' });
        }

        if (pending.otp !== String(code).trim()) {
            pending.attempts += 1;
            await cacheService.set(pendingKey(emailLower), pending, OTP_TTL_S);
            return res.status(400).json({ error: 'Invalid verification code.' });
        }

        // OTP correct — remove from Redis and create user + client in DB
        await cacheService.delete(pendingKey(emailLower));

        const user = new User({
            given_name:    pending.given_name,
            family_name:   pending.family_name || undefined,
            email:         emailLower,
            username:      emailLower,
            password:      pending.password,
            locale:        pending.locale || 'en',
            role:          'admin',
            emailVerified: true,
        });
        await user.save();

        const cid = await User.generateUniqueCID();
        const clientDoc = new Client({
            cid,
            description: user.given_name + (user.family_name ? ' ' + user.family_name : '') + "'s site",
            users: [user._id],
        });
        await clientDoc.save();

        const clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const payload = await getSuccessfulLoginPayload(user, clientIp);

        return res.status(200).json({ ...payload, client: { cid: clientDoc.cid, description: clientDoc.description } });
    } catch (error) {
        console.error('Email verification error:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message });
        }
        return res.status(500).json({ error: 'Internal server error during verification.' });
    }
};

// ---------------------------------------------------------------------------
// POST /auth/resend-verification
// ---------------------------------------------------------------------------

exports.resendVerification = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'email is required.' });
        }

        const emailLower = email.trim().toLowerCase();
        const pending = await cacheService.get(pendingKey(emailLower));

        if (!pending) {
            // Don't reveal whether the email is registered or not
            return res.status(200).json({ message: 'If that email has a pending registration, a new code has been sent.' });
        }

        pending.otp      = generateOtp();
        pending.attempts = 0;
        await cacheService.set(pendingKey(emailLower), pending, OTP_TTL_S);

        await sendVerificationEmail(pending).catch(err =>
            console.error('Failed to send verification email:', err)
        );

        return res.status(200).json({ message: 'A new verification code has been sent.' });
    } catch (error) {
        console.error('Resend verification error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

// ---------------------------------------------------------------------------
// GET /auth/captcha
// Generates a one-time SVG CAPTCHA challenge. The answer is stored in Redis
// (TTL 5 min). The client receives the SVG and a token; both must be included
// in the subsequent /request-recovery call.
// ---------------------------------------------------------------------------

const CAPTCHA_TTL_S = 5 * 60;
const captchaKey = (token) => `captcha:${token}`;

exports.getCaptcha = (req, res) => {
    try {
        const captcha = svgCaptcha.create({
            size:       5,
            noise:      2,
            color:      true,
            background: '#f8f8f8',
            width:      180,
            height:     56,
            fontSize:   46,
        });

        const token = crypto.randomUUID();
        cacheService.set(captchaKey(token), captcha.text.toLowerCase(), CAPTCHA_TTL_S)
            .catch(err => console.error('Captcha cache error:', err));

        res.set('Content-Type', 'application/json');
        return res.json({ token, svg: captcha.data });
    } catch (error) {
        console.error('Captcha generation error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

// ---------------------------------------------------------------------------
// Password recovery helpers
// ---------------------------------------------------------------------------

const recoveryKey = (username) => `password_recovery:${username}`;

async function sendRecoveryEmail(user, otp) {
    const locale = user.locale || 'en';
    const subject   = await getLocalizedMessage('email.password_recovery.subject',  locale, {}, DASHBOARD_LOCALES_PATH);
    const title     = await getLocalizedMessage('email.password_recovery.title',    locale, {}, DASHBOARD_LOCALES_PATH);
    const greeting  = await getLocalizedMessage('email.password_recovery.greeting', locale, { name: user.given_name || user.username }, DASHBOARD_LOCALES_PATH);
    const intro     = await getLocalizedMessage('email.password_recovery.intro',    locale, {}, DASHBOARD_LOCALES_PATH);
    const codeLabel = await getLocalizedMessage('email.password_recovery.code_label', locale, { code: otp }, DASHBOARD_LOCALES_PATH);
    const codeExpiry= await getLocalizedMessage('email.password_recovery.code_expiry', locale, {}, DASHBOARD_LOCALES_PATH);
    const ignore    = await getLocalizedMessage('email.password_recovery.ignore',   locale, {}, DASHBOARD_LOCALES_PATH);

    const body = `
        <h2>${title}</h2>
        <p>${greeting}</p>
        <p>${intro}</p>
        <p style="font-size:2rem;font-weight:700;letter-spacing:0.4rem;text-align:center;padding:16px 0;">${otp}</p>
        <p style="font-size:0.85rem;color:#666;">${codeLabel}</p>
        <p style="font-size:0.85rem;color:#666;">${codeExpiry}</p>
        <p style="font-size:0.8rem;color:#999;">${ignore}</p>
    `;

    const emailHtml = verificationTemplate({ title: subject, body, actionUrl: '', actionText: '' });
    await addEmailJob('SYSTEM', null, subject, emailHtml, user.email, { force: true });
}

// ---------------------------------------------------------------------------
// POST /auth/request-recovery
// Accepts username or email. Always returns the same message to avoid
// user enumeration. Stores a short-lived OTP in Redis and emails it.
// ---------------------------------------------------------------------------

exports.requestRecovery = async (req, res) => {
    try {
        const { username, captchaToken, captchaAnswer } = req.body;
        if (!username || !captchaToken || !captchaAnswer) {
            return res.status(400).json({ error: 'Username and captcha are required.' });
        }

        const storedAnswer = await cacheService.get(captchaKey(captchaToken));
        await cacheService.delete(captchaKey(captchaToken));
        if (!storedAnswer || storedAnswer !== captchaAnswer.trim().toLowerCase()) {
            return res.status(400).json({ error: 'Invalid captcha.', captchaInvalid: true });
        }

        const normalised = username.trim().toLowerCase();
        const ambiguousResponse = { message: 'If that account exists, a recovery code has been sent to the associated email.' };

        const user = await User.findOne({ $or: [{ username: normalised }, { email: normalised }] })
            .setOptions({ loadClients: false });

        if (!user || !user.email || user.isDeleted) {
            return res.status(200).json(ambiguousResponse);
        }

        const otp = generateOtp();
        await cacheService.set(recoveryKey(user.username), { username: user.username, otp, attempts: 0 }, OTP_TTL_S);

        sendRecoveryEmail(user, otp).catch(err =>
            console.error('Recovery email error:', err)
        );

        return res.status(200).json(ambiguousResponse);
    } catch (error) {
        console.error('Request recovery error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

// ---------------------------------------------------------------------------
// POST /auth/verify-recovery
// Validates the OTP and returns a one-time reset token (JWT, 15 min TTL).
// ---------------------------------------------------------------------------

exports.verifyRecovery = async (req, res) => {
    try {
        const { username, code } = req.body;
        if (!username || !code) {
            return res.status(400).json({ error: 'Username and code are required.' });
        }

        const normalised = username.trim().toLowerCase();
        const user = await User.findOne({ $or: [{ username: normalised }, { email: normalised }] })
            .setOptions({ loadClients: false });

        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired recovery code.' });
        }

        const key = recoveryKey(user.username);
        const pending = await cacheService.get(key);

        if (!pending) {
            return res.status(400).json({ error: 'Invalid or expired recovery code.' });
        }

        if (pending.attempts >= MAX_VERIFICATION_ATTEMPTS) {
            await cacheService.delete(key);
            return res.status(429).json({ error: 'Too many attempts. Please request a new recovery code.' });
        }

        if (pending.otp !== String(code).trim()) {
            pending.attempts += 1;
            await cacheService.set(key, pending, OTP_TTL_S);
            return res.status(400).json({ error: 'Invalid recovery code.' });
        }

        await cacheService.delete(key);

        const resetToken = jwt.sign(
            { username: user.username, type: 'PASSWORD_RESET' },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );

        return res.status(200).json({ resetToken });
    } catch (error) {
        console.error('Verify recovery error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};

// ---------------------------------------------------------------------------
// POST /auth/reset-password
// Validates the reset token and updates the password.
// ---------------------------------------------------------------------------

exports.resetPassword = async (req, res) => {
    try {
        const { resetToken, newPassword } = req.body;
        if (!resetToken || !newPassword) {
            return res.status(400).json({ error: 'Reset token and new password are required.' });
        }

        const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;
        if (!strongPassword.test(newPassword)) {
            return res.status(400).json({ error: 'Password does not meet security requirements.' });
        }

        let payload;
        try {
            payload = jwt.verify(resetToken, process.env.JWT_SECRET);
            if (payload.type !== 'PASSWORD_RESET') throw new Error('Invalid token type.');
        } catch {
            return res.status(401).json({ error: 'Invalid or expired reset token. Please request a new code.' });
        }

        const user = await User.findOne({ username: payload.username }).setOptions({ loadClients: false });
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        user.password = newPassword;
        user.failedLoginAttempts = 0;
        user.lockUntil = undefined;
        await user.save();

        return res.status(200).json({ message: 'Password reset successfully.' });
    } catch (error) {
        console.error('Reset password error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};