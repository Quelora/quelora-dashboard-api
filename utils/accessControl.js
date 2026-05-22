/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: quelora-dashboard-api/utils/accessControl.js
const Client = require('@quelora/common/models/Client');
const { cacheService } = require('@quelora/common/services/cacheService');
const { mongoose } = require('@quelora/common/db');

exports.getFilterCids = async (userId, role, requestedCids) => {
    let allowedCids;

    if (role === 'god') {
        if (requestedCids) {
            return Array.isArray(requestedCids) ? requestedCids : [requestedCids];
        }

        const cacheKey = `active_cid:${userId}`;
        const activeClient = await cacheService.get(cacheKey);

        if (activeClient && activeClient.cid) {
            console.log(`[ACL] User 'god' using active CID: ${activeClient.cid}`);
            allowedCids = [activeClient.cid];
        } else {
            return [];
        }
    } else {
        const clientDocs = await Client.find({ users: userId }).select('cid');
        const userAllowedCids = clientDocs.map(c => c.cid);

        if (requestedCids) {
            const requestedCidsArray = Array.isArray(requestedCids) ? requestedCids : [requestedCids];
            const allAllowed = requestedCidsArray.every(cid => userAllowedCids.includes(cid));
            if (!allAllowed) {
                throw new Error('Access denied to one or more requested client IDs');
            }
            allowedCids = requestedCidsArray;
        } else {
            allowedCids = userAllowedCids;
        }
    }

    return allowedCids;
};

exports.validateCidAccess = async (userId, role, targetCids) => {
    const cidsArray = Array.isArray(targetCids) ? targetCids : [targetCids].filter(Boolean);

    if (cidsArray.length === 0) {
        throw new Error('At least one CID is required for this operation');
    }

    if (role === 'god') {
        console.log(`[ACL] User 'god' granted access to CIDs: ${cidsArray.join(', ')}`);
        return true;
    }

    const allowedCount = await Client.countDocuments({ cid: { $in: cidsArray }, users: userId });

    if (allowedCount !== cidsArray.length) {
        throw new Error('Access denied to one or more client IDs');
    }

    return true;
};

exports.validateResourceAccess = async (doc, userId, role) => {
    if (!doc) {
        throw new Error('Resource not found');
    }

    const docCids = (Array.isArray(doc.cids) ? doc.cids : [doc.cid]).filter(Boolean);

    if (role === 'god') {
        console.log(`[ACL] User 'god' granted access to resource with CIDs: ${docCids.join(', ')}`);
        return true;
    }

    const hasAccess = await Client.exists({ cid: { $in: docCids }, users: userId });

    if (!hasAccess) {
        throw new Error('Access denied to this resource');
    }

    return true;
};
