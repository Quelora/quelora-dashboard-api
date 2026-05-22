/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: packages/quelora-dashboard-api/controllers/jobsController.js
const Client          = require('@quelora/common/models/Client');
const JobExecutionLog = require('@quelora/common/models/JobExecutionLog');
const { createQueue } = require('@quelora/common/infrastructure/bullmq');
const { QUEUES }      = require('@quelora/common/constants/queues');
const { getFilterCids, validateCidAccess } = require('../utils/accessControl');

// ---------------------------------------------------------------------------
// Job catalogue — mirrors quelora-jobs/scheduler.js definitions
// ---------------------------------------------------------------------------

const CLIENT_JOB_DEFS = {
    reputation:      { queueName: QUEUES.REPUTATION, defaultCron: '*/30 * * * * *' },
    suggestion: {
        queueName:   QUEUES.SUGGESTION,
        defaultCron: '0 2 * * *',
        configSchema: [
            { key: 'suggestionLimit',              section: 'general', type: 'number', default: 20,  labelKey: 'jobs.config.suggestion.suggestionLimit.label',              descKey: 'jobs.config.suggestion.suggestionLimit.desc',              validation: { min: 5,   max: 100, step: 1   } },
            { key: 'daysActive',                   section: 'general', type: 'number', default: 7,   labelKey: 'jobs.config.suggestion.daysActive.label',                   descKey: 'jobs.config.suggestion.daysActive.desc',                   validation: { min: 1,   max: 90,  step: 1   } },
            { key: 'interestWindowDays',           section: 'general', type: 'number', default: 35,  labelKey: 'jobs.config.suggestion.interestWindowDays.label',           descKey: 'jobs.config.suggestion.interestWindowDays.desc',           validation: { min: 7,   max: 180, step: 1   } },
            { key: 'weights.socialConnection',     section: 'weights', type: 'number', default: 5,   labelKey: 'jobs.config.suggestion.weights.socialConnection.label',     descKey: 'jobs.config.suggestion.weights.socialConnection.desc',     validation: { min: 0,   max: 20,  step: 1   } },
            { key: 'weights.interestMatch',        section: 'weights', type: 'number', default: 4,   labelKey: 'jobs.config.suggestion.weights.interestMatch.label',        descKey: 'jobs.config.suggestion.weights.interestMatch.desc',        validation: { min: 0,   max: 20,  step: 1   } },
            { key: 'weights.geoExact',             section: 'weights', type: 'number', default: 10,  labelKey: 'jobs.config.suggestion.weights.geoExact.label',             descKey: 'jobs.config.suggestion.weights.geoExact.desc',             validation: { min: 0,   max: 50,  step: 1   } },
            { key: 'weights.geoNear',              section: 'weights', type: 'number', default: 5,   labelKey: 'jobs.config.suggestion.weights.geoNear.label',              descKey: 'jobs.config.suggestion.weights.geoNear.desc',              validation: { min: 0,   max: 50,  step: 1   } },
            { key: 'weights.verified',             section: 'weights', type: 'number', default: 5,   labelKey: 'jobs.config.suggestion.weights.verified.label',             descKey: 'jobs.config.suggestion.weights.verified.desc',             validation: { min: 0,   max: 20,  step: 1   } },
            { key: 'weights.popularityMultiplier', section: 'weights', type: 'number', default: 3,   labelKey: 'jobs.config.suggestion.weights.popularityMultiplier.label', descKey: 'jobs.config.suggestion.weights.popularityMultiplier.desc', validation: { min: 0,   max: 10,  step: 0.5 } },
        ],
    },
    activity:        { queueName: QUEUES.ACTIVITY,   defaultCron: '*/10 * * * * *' },
    'gravity-decay': {
        queueName:   QUEUES.GRAVITY,
        defaultCron: '*/30 * * * *',
        configSchema: [
            { key: 'maxAgeDays', section: 'general', type: 'number', default: 7, labelKey: 'jobs.config.gravityDecay.maxAgeDays.label', descKey: 'jobs.config.gravityDecay.maxAgeDays.desc', validation: { min: 1, max: 365, step: 1 } },
        ],
    },
    // Enterprise jobs — only shown when the client has the enterprise module enabled
    gamification: { queueName: QUEUES.ENTERPRISE, defaultCron: '*/5 * * * * *', enterprise: true },
    'ad-stats':   { queueName: QUEUES.ENTERPRISE, defaultCron: '*/5 * * * * *', enterprise: true },
};

const SYSTEM_JOB_DEFS = {
    'stats-rollup':       { queueName: QUEUES.SYSTEM, defaultCron: '*/5 * * * *'  },
    'profile-stats':      { queueName: QUEUES.SYSTEM, defaultCron: '*/15 * * * *' },
    'geo-update':         { queueName: QUEUES.SYSTEM, defaultCron: '0 4 * * *'    },
    'token-usage-rollup': { queueName: QUEUES.SYSTEM, defaultCron: '*/5 * * * *'  },
    'daily-rollup':       { queueName: QUEUES.SYSTEM, defaultCron: '5 1 * * *'    },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pickLastLog = (log) => log ? {
    status:      log.status,
    startedAt:   log.startedAt,
    completedAt: log.completedAt,
    durationMs:  log.durationMs,
    error:       log.error || null,
} : null;

async function lastLogMap(cid, jobKeys) {
    const rows = await JobExecutionLog.aggregate([
        { $match: { cid, jobName: { $in: jobKeys } } },
        { $sort:  { startedAt: -1 } },
        { $group: { _id: '$jobName', doc: { $first: '$$ROOT' } } },
    ]);
    return Object.fromEntries(rows.map(r => [r._id, r.doc]));
}

// ---------------------------------------------------------------------------
// GET /jobs
// ---------------------------------------------------------------------------

exports.getJobs = async (req, res, next) => {
    try {
        const { _id: userId, role } = req.user;

        const cids = await getFilterCids(userId, role);
        if (!cids.length) return res.json({ jobs: [], systemJobs: [] });

        const cid    = cids[0];
        const client = await Client.findOne({ cid });
        if (!client) return res.status(404).json({ error: 'Client not found' });

        const jobsConfig   = client.jobsConfig || {};
        const clientKeys   = Object.keys(CLIENT_JOB_DEFS);
        const clientLogMap = await lastLogMap(cid, clientKeys);

        const jobs = clientKeys.map(key => {
            const def    = CLIENT_JOB_DEFS[key];
            const config = jobsConfig[key] || {};

            let params = null;
            if (def.configSchema) {
                const storedParams = config.params || {};
                params = {};
                def.configSchema.forEach(field => {
                    const parts = field.key.split('.');
                    if (parts.length === 1) {
                        params[field.key] = storedParams[field.key] ?? field.default;
                    } else {
                        const [section, subKey] = parts;
                        if (!params[section]) params[section] = {};
                        params[section][subKey] = (storedParams[section] || {})[subKey] ?? field.default;
                    }
                });
            }

            return {
                key,
                type:           'client',
                queueName:      def.queueName,
                enabled:        config.enabled !== undefined ? config.enabled : true,
                cronExpression: config.cronExpression || def.defaultCron,
                defaultCron:    def.defaultCron,
                enterprise:     def.enterprise || false,
                readOnly:       false,
                configSchema:   def.configSchema || null,
                params,
                lastLog:        pickLastLog(clientLogMap[key]),
            };
        });

        let systemJobs = [];
        if (role === 'god') {
            const systemKeys = Object.keys(SYSTEM_JOB_DEFS);
            const sysLogMap  = await lastLogMap('system', systemKeys);
            systemJobs = systemKeys.map(key => {
                const def = SYSTEM_JOB_DEFS[key];
                return {
                    key,
                    type:           'system',
                    queueName:      def.queueName,
                    enabled:        true,
                    cronExpression: def.defaultCron,
                    defaultCron:    def.defaultCron,
                    readOnly:       true,
                    lastLog:        pickLastLog(sysLogMap[key]),
                };
            });
        }

        return res.json({ jobs, systemJobs });
    } catch (err) {
        next(err);
    }
};

// ---------------------------------------------------------------------------
// PATCH /jobs/:jobKey
// ---------------------------------------------------------------------------

exports.updateJob = async (req, res, next) => {
    try {
        const { jobKey } = req.params;
        const { _id: userId, role } = req.user;

        if (!CLIENT_JOB_DEFS[jobKey]) {
            return res.status(400).json({ error: `Unknown or read-only job: ${jobKey}` });
        }

        const cids = await getFilterCids(userId, role);
        if (!cids.length) return res.status(403).json({ error: 'No client access' });
        const cid = cids[0];

        await validateCidAccess(userId, role, cid);

        const client = await Client.findOne({ cid });
        if (!client) return res.status(404).json({ error: 'Client not found' });

        const { enabled, cronExpression, params } = req.body;

        if (cronExpression !== undefined && role !== 'god') {
            return res.status(403).json({ error: 'Only god role can modify the cron schedule' });
        }

        const existing = (client.jobsConfig || {})[jobKey] || {};

        if (!client.jobsConfig) client.jobsConfig = {};
        client.jobsConfig[jobKey] = {
            ...existing,
            ...(enabled        !== undefined ? { enabled }        : {}),
            ...(cronExpression !== undefined ? { cronExpression } : {}),
            ...(params         !== undefined ? { params: { ...(existing.params || {}), ...params } } : {}),
        };
        client.markModified('jobsConfig');
        await client.save();

        return res.json({ success: true, job: { key: jobKey, ...client.jobsConfig[jobKey] } });
    } catch (err) {
        next(err);
    }
};

// ---------------------------------------------------------------------------
// POST /jobs/:jobKey/trigger
// ---------------------------------------------------------------------------

exports.triggerJob = async (req, res, next) => {
    try {
        const { jobKey } = req.params;
        const { _id: userId, role } = req.user;

        const isClient = !!CLIENT_JOB_DEFS[jobKey];
        const isSystem = !!SYSTEM_JOB_DEFS[jobKey];

        if (!isClient && !isSystem) {
            return res.status(400).json({ error: `Unknown job: ${jobKey}` });
        }
        if (isSystem && role !== 'god') {
            return res.status(403).json({ error: 'Only god role can trigger system jobs' });
        }

        let cid = 'system';
        if (isClient) {
            const cids = await getFilterCids(userId, role);
            if (!cids.length) return res.status(403).json({ error: 'No client access' });
            cid = cids[0];
        }

        const def   = isClient ? CLIENT_JOB_DEFS[jobKey] : SYSTEM_JOB_DEFS[jobKey];
        const queue = createQueue(def.queueName);
        // BullMQ does not allow ':' in custom job IDs
        const jobId = `manual_${cid}_${jobKey}_${Date.now()}`;

        await queue.add(
            jobKey,
            { cid, type: jobKey, manual: true },
            { jobId, removeOnComplete: 10, removeOnFail: 50 },
        );

        return res.json({ success: true, jobId });
    } catch (err) {
        next(err);
    }
};

// ---------------------------------------------------------------------------
// GET /jobs/logs
// ---------------------------------------------------------------------------

exports.getLogs = async (req, res, next) => {
    try {
        const { _id: userId, role } = req.user;
        const { jobName, status, page = 1, limit = 50 } = req.query;

        const cids = await getFilterCids(userId, role);

        const filter = {};

        if (role === 'god') {
            if (cids.length) filter.cid = { $in: [...cids, 'system'] };
        } else {
            if (!cids.length) return res.json({ logs: [], total: 0, page: 1, limit: 50 });
            filter.cid = { $in: cids };
        }

        if (jobName) filter.jobName = jobName;
        if (status)  filter.status  = status;

        const skip = (Math.max(parseInt(page), 1) - 1) * parseInt(limit);

        const [logs, total] = await Promise.all([
            JobExecutionLog.find(filter)
                .sort({ startedAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            JobExecutionLog.countDocuments(filter),
        ]);

        return res.json({ logs, total, page: parseInt(page), limit: parseInt(limit) });
    } catch (err) {
        next(err);
    }
};