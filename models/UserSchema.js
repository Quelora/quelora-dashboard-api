/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// packages/quelora-common/models/UserSchema.js
const { mongoose } = require('@quelora/common/db');

/**
* Schema factory for creating clean instances
* of userSchema and clientSchema, avoiding conflicts
* of prototypes in Mongoose.
*/
function createSchemas() {
    const userSchema = new mongoose.Schema({
        given_name: {
            type: String,
            required: true,
        },
        family_name: {
            type: String,
            required: false,
        },
        email: {
            type: String,
            required: false,
            trim: true,
            lowercase: true,
            validate: {
                validator: function (v) {
                    return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
                },
                message: props => `${props.value} is not a valid email`
            }
        },
        username: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            maxlength: 50,
            match: [/^[a-zA-Z0-9_@.\-]+$/, 'Username can only contain letters, numbers, underscores, dots, or the @ symbol (for emails).']
        },
        picture: {
            type: String,
            required: false,
        },
        locale: {
            type: String,
            trim: true,
            default: 'en'
        },
        password: {
            type: String,
            required: true,
            minlength: [8, 'Password must be at least 8 characters long']
        },
        role: {
            type: String,
            enum: ['god', 'admin', 'editor', 'analyst', 'advertiser', 'moderator', 'user'],
            default: 'editor'
        },
        mustChangePassword: {
            type: Boolean,
            default: false
        },
        failedLoginAttempts: {
            type: Number,
            default: 0
        },
        lockUntil: {
            type: Date
        },
        lastFailedIp: { type: String, required: false },
        twoFactorEnabled: {
            type: Boolean,
            default: false
        },
        twoFactorSecret: {
            type: String,
            required: false 
        },
        isDeleted: {
            type: Boolean,
            default: false,
            index: true
        },

        // ── Email verification ───────────────────────────────────────────────
        emailVerified: {
            type: Boolean,
            default: false,
        },
        emailVerificationCode: {
            type: String,
            required: false,
        },
        emailVerificationExpires: {
            type: Date,
            required: false,
        },
        emailVerificationAttempts: {
            type: Number,
            default: 0,
        },

        // ── Enterprise plan ──────────────────────────────────────────────────
        accountType: {
            type: String,
            enum: ['community', 'enterprise'],
            default: 'community',
        },
        enterpriseModules: {
            type: [String],
            default: [],
            validate: {
                validator: (arr) => arr.every(m => typeof m === 'string' && m.length > 0),
                message: 'enterpriseModules must be an array of non-empty strings',
            },
        },

        createdAt: {
            type: Date,
            default: Date.now
        },
        updatedAt: {
            type: Date,
            default: Date.now
        }
    });

    // AXIOMA ARQUITECTÓNICO: Interceptor pre-hidratación (Raw POJO)
    // Muta el documento literal del driver de MongoDB antes de que el Cast Engine
    // de Mongoose intente procesarlo, aniquilando el CastError de raíz.
    userSchema.pre('init', function(obj) {
        const parseExtendedJsonDate = (val) => {
            if (val && typeof val === 'object' && val.$date) {
                return new Date(val.$date);
            }
            return val;
        };

        if (obj) {
            if (obj.createdAt) obj.createdAt = parseExtendedJsonDate(obj.createdAt);
            if (obj.updatedAt) obj.updatedAt = parseExtendedJsonDate(obj.updatedAt);
            if (obj.lockUntil) obj.lockUntil = parseExtendedJsonDate(obj.lockUntil);
        }
    });

    return { userSchema };
}

module.exports = createSchemas;