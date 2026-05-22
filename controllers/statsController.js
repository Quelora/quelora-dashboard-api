/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: quelora-dashboard-api/controllers/statsController.js
const { mongoose } = require('@quelora/common/db');
const Post = require('@quelora/common/models/Post');
const Profile = require('@quelora/common/models/Profile');
const Stats = require('@quelora/common/models/Stats');
const GeoStats = require('@quelora/common/models/GeoStats');
const PostStats = require('@quelora/common/models/PostStats');
const GeoPostStats = require('@quelora/common/models/GeoPostStats');
const ProfileStats = require('@quelora/common/models/ProfileStats');
const ProfileStatsDaily = require('@quelora/common/models/ProfileStatsDaily');
const TokenUsageStats = require('@quelora/common/models/TokenUsageStats');
const ReputationLog = require('@quelora/common/models/ReputationLog');

const { getFilterCids } = require('../utils/accessControl');

const getValidDateRange = (dateFromQuery, dateToQuery) => {
    let dateTo = dateToQuery ? new Date(dateToQuery) : new Date();
    const now = new Date();
    const defaultDateFrom = new Date();
    defaultDateFrom.setDate(now.getDate() - 7); 

    let dateFrom = dateFromQuery ? new Date(dateFromQuery) : null;

    if (!dateFrom || dateFrom > dateTo) {
        dateFrom = defaultDateFrom;
        dateTo = now;
    } else {
        const oneDayMs = 24 * 60 * 60 * 1000;
        if ((dateTo.getTime() - dateFrom.getTime()) < oneDayMs) {
            dateFrom = new Date(dateTo.getTime() - oneDayMs);
        }
    }
    return { dateFrom, dateTo };
};

exports.getSystemStats = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const userRole = req.user.role;
        const { cid } = req.query;

        let cidsToUse;
        try {
            cidsToUse = await getFilterCids(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: e.message });
        }

        const { dateFrom, dateTo } = getValidDateRange(req.query.dateFrom, req.query.dateTo);

        const baseFilter = { cid: { $in: cidsToUse } };
        
        const postFilter = {
            ...baseFilter,
            created_at: { $gte: dateFrom, $lte: dateTo }
        };
        
        const totalUsers = await Profile.countDocuments(baseFilter);

        const totalPosts = await Post.countDocuments(postFilter);

        
        const totalCommentsResult = await Post.aggregate([
            { $match: postFilter },
            {
                $group: {
                    _id: null,
                    totalComments: { $sum: '$commentCount' }
                }
            }
        ]);
        const totalComments = totalCommentsResult[0]?.totalComments || 0;

        const totalLikesResult = await Post.aggregate([
            { $match: postFilter },
            {
                $group: {
                    _id: null,
                    totalLikes: { $sum: '$likesCount' }
                }
            }
        ]);
        const totalLikes = totalLikesResult[0]?.totalLikes || 0;

        const totalSharesResult = await Post.aggregate([
            { $match: postFilter },
            {
                $group: {
                    _id: null,
                    totalShares: { $sum: '$sharesCount' }
                }
            }
        ]);
        const totalShares = totalSharesResult[0]?.totalShares || 0;

        const statsByHour = await Stats.aggregate([
            {
                $match: {
                    cid: { $in: cidsToUse },
                    timestamp: { $gte: dateFrom, $lte: dateTo }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d %H', date: '$timestamp' }
                    },
                    likesAdded: { $sum: '$likesAdded' },
                    likesRemoved: { $sum: '$likesRemoved' },
                    sharesAdded: { $sum: '$sharesAdded' },
                    commentsAdded: { $sum: '$commentsAdded' },
                    repliesAdded: { $sum: '$repliesAdded' }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        res.status(200).json({
            success: true,
            totalUsers,
            totalPosts,
            totalComments,
            totalLikes,
            totalShares,
            statsByHour: statsByHour.map(hour => ({
                dateHour: hour._id,
                likesAdded: hour.likesAdded,
                likesRemoved: hour.likesRemoved,
                sharesAdded: hour.sharesAdded,
                commentsAdded: hour.commentsAdded,
                repliesAdded: hour.repliesAdded
            })),
            dateRange: {
                from: dateFrom.toISOString(),
                to: dateTo.toISOString()
            },
            cids: cidsToUse
        });
    } catch (error) {
        console.error('Error fetching system stats:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

exports.searchGeoStats = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const userRole = req.user.role;
        const { cid, dateFrom, dateTo, action } = req.query;

        let cidsToUse;
        try {
            cidsToUse = await getFilterCids(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: e.message });
        }

        const { dateFrom: from, dateTo: to } = getValidDateRange(dateFrom, dateTo);
        
        let actionsToUse = [];
        if (action) {
            actionsToUse = Array.isArray(action) ? action : action.split(',').map(a => a.trim());
        } else {
            actionsToUse = ['comment'];
        }

        const matchFilter = {
            cid: { $in: cidsToUse },
            action: { $in: actionsToUse }, 
            timestamp: { $gte: from, $lte: to }
        };

        const results = await GeoStats.aggregate([
            {
                $match: matchFilter
            },
            {
                $group: {
                    _id: {
                        action: '$action',
                        country: '$country',
                        countryCode: '$countryCode',
                        region: '$region',
                        regionCode: '$regionCode',
                        city: '$city',
                        latitude: '$latitude',
                        longitude: '$longitude'
                    },
                    total: { $sum: '$count' }
                }
            },
            { $sort: { total: -1 } },
            {
                $project: {
                    _id: 0,
                    action: '$_id.action',
                    country: '$_id.country',
                    countryCode: { $ifNull: ['$_id.countryCode', null] },
                    region: '$_id.region',
                    regionCode: { $ifNull: ['$_id.regionCode', null] },
                    city: '$_id.city',
                    latitude: { $ifNull: ['$_id.latitude', null] },
                    longitude: { $ifNull: ['$_id.longitude', null] },
                    total: 1
                }
            }
        ]);

        const cleanResults = results.map(item => {
            const cleanedItem = {};
            Object.keys(item).forEach(key => {
                if (item[key] !== null && item[key] !== undefined) {
                    cleanedItem[key] = item[key];
                }
            });
            return cleanedItem;
        });

        return res.status(200).json({
            success: true,
            data: cleanResults,
            dateRange: {
                from: from.toISOString(),
                to: to.toISOString()
            },
            cids: cidsToUse,
            actions: actionsToUse
        });

    } catch (error) {
        console.error('Error fetching geo stats:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

exports.getPostListStats = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const userRole = req.user.role;
        const { cid, page = 1, limit = 10, sortBy = 'viewsCount', sortOrder = 'desc', dateFrom, dateTo } = req.query;

        let cidsToUse;
        try {
            cidsToUse = await getFilterCids(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: e.message });
        }

        const { dateFrom: from, dateTo: to } = getValidDateRange(dateFrom, dateTo);
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const limitValue = parseInt(limit);
        
        const sortDirection = sortOrder === 'asc' ? 1 : -1;
        const sortCriteria = { [sortBy]: sortDirection, _id: sortDirection };

        const matchFilter = {
            cid: { $in: cidsToUse },
            created_at: { $gte: from, $lte: to },
            'deletion.status': 'active'
        };

        const countResult = await Post.aggregate([
            { $match: matchFilter },
            { $count: "totalCount" }
        ]);
        const totalCount = countResult.length > 0 ? countResult[0].totalCount : 0;
        
        const posts = await Post.aggregate([
            { $match: matchFilter },
            { $sort: sortCriteria },
            { $skip: skip },
            { $limit: limitValue },
            {
                $project: {
                    _id: 0,
                    entity: '$entity',
                    title: { $ifNull: ['$title', '(Sin título)'] },
                    link: { $ifNull: ['$link', null] },
                    viewsCount: '$viewsCount',
                    likesCount: '$likesCount',
                    commentCount: '$commentCount',
                    sharesCount: '$sharesCount',
                    created_at: '$created_at'
                }
            }
        ]);

        res.status(200).json({
            success: true,
            data: posts,
            pagination: {
                totalPosts: totalCount,
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / limitValue),
                limit: limitValue
            },
            dateRange: {
                from: from.toISOString(),
                to: to.toISOString()
            },
            cids: cidsToUse
        });

    } catch (error) {
        console.error('Error fetching post list stats:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

exports.getPostAnalytics = async (req, res, next) => {
    try {
        const { entity } = req.params;
        const { cid } = req.query;
        const userId = req.user._id;
        const userRole = req.user.role;

        try {
            await getFilterCids(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: e.message });
        }

        if (!mongoose.Types.ObjectId.isValid(entity)) {
            return res.status(400).json({ success: false, error: 'Invalid entity ID' });
        }
        
        const entityObjectId = new mongoose.Types.ObjectId(entity);

        const post = await Post.findOne({ entity, cid }).select('_id entity likesCount sharesCount commentCount').lean();
        if (!post) {
            return res.status(404).json({ success: false, error: 'Post not found' });
        }

        const { dateFrom, dateTo } = getValidDateRange(req.query.dateFrom, req.query.dateTo);

        const postStatsByHour = await PostStats.aggregate([
            {
                $match: {
                    cid,
                    entity: entityObjectId,
                    timestamp: { $gte: dateFrom, $lte: dateTo }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d %H', date: '$timestamp' }
                    },
                    likesAdded: { $sum: '$likesAdded' },
                    likesRemoved: { $sum: '$likesRemoved' },
                    sharesAdded: { $sum: '$sharesAdded' },
                    commentsAdded: { $sum: '$commentsAdded' },
                    repliesAdded: { $sum: '$repliesAdded' }
                }
            },
            { 
                $project: {
                    _id: 0,
                    dateHour: '$_id',
                    likesAdded: 1,
                    likesRemoved: 1,
                    sharesAdded: 1,
                    commentsAdded: 1,
                    repliesAdded: 1
                }
            },
            { $sort: { dateHour: 1 } }
        ]);

        const geoStats = await GeoPostStats.aggregate([
            {
                $match: {
                    cid,
                    entity: entityObjectId,
                    action: { $in: ['like', 'share', 'comment', 'reply'] },
                    timestamp: { $gte: dateFrom, $lte: dateTo }
                }
            },
            {
                $group: {
                    _id: {
                        action: '$action',
                        country: '$country',
                        countryCode: '$countryCode',
                        region: '$region',
                        regionCode: '$regionCode',
                        city: '$city',
                        latitude: '$latitude',
                        longitude: '$longitude'
                    },
                    total: { $sum: '$count' }
                }
            },
            { $sort: { total: -1 } },
            {
                $project: {
                    _id: 0,
                    action: '$_id.action',
                    country: '$_id.country',
                    countryCode: { $ifNull: ['$_id.countryCode', null] },
                    region: '$_id.region',
                    regionCode: { $ifNull: ['$_id.regionCode', null] },
                    city: '$_id.city',
                    latitude: { $ifNull: ['$_id.latitude', null] },
                    longitude: { $ifNull: ['$_id.longitude', null] },
                    total: 1
                }
            }
        ]);
        
        const interactionTotals = {
            comments: post.commentCount,
            likes: post.likesCount,
            shares: post.sharesCount
        };

        res.status(200).json({
            success: true,
            entityId: entity,
            interactionTotals,
            postStatsByHour,
            geoStats,
            dateRange: {
                from: dateFrom.toISOString(),
                to: dateTo.toISOString()
            }
        });

    } catch (error) {
        console.error('Error fetching post analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

exports.getTopUsersByComments = async (req, res, next) => {
    
};

exports.getProfileAnalytics = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const userRole = req.user.role;
        const { cid, page = 1, limit = 10, sortBy = 'commentsAdded', sortOrder = 'desc', dateFrom, dateTo } = req.query;

        let cidsToUse;
        try {
            cidsToUse = await getFilterCids(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: e.message });
        }

        const { dateFrom: from, dateTo: to } = getValidDateRange(dateFrom, dateTo);
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const limitValue = parseInt(limit);
        const sortDirection = sortOrder === 'asc' ? 1 : -1;
        const sortCriteria = { [sortBy]: sortDirection, _id: sortDirection };

        const diffTime = Math.abs(to.getTime() - from.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        let ModelToUse;
        let dateTruncExpression;

        // --- Optimized Aggregation Strategy ---
        if (diffDays <= 2) {
            ModelToUse = ProfileStats;
            dateTruncExpression = {
                $dateFromParts: {
                    'year': { $year: { date: "$date", timezone: "UTC" } },
                    'month': { $month: { date: "$date", timezone: "UTC" } },
                    'day': { $dayOfMonth: { date: "$date", timezone: "UTC" } },
                    'hour': { $hour: { date: "$date", timezone: "UTC" } },
                    'timezone': "UTC"
                }
            };
        } else {
            ModelToUse = ProfileStatsDaily;
            dateTruncExpression = {
                $dateFromParts: {
                    'year': { $year: { date: "$date", timezone: "UTC" } },
                    'month': { $month: { date: "$date", timezone: "UTC" } },
                    'day': { $dayOfMonth: { date: "$date", timezone: "UTC" } },
                    'timezone': "UTC"
                }
            };
        }

        const matchFilter = {
            cid: { $in: cidsToUse },
            date: { $gte: from, $lte: to }
        };

        const [aggregation, timeSeriesData] = await Promise.all([
            ModelToUse.aggregate([
                { $match: matchFilter },
                {
                    $group: {
                        _id: { author: "$author", cid: "$cid" },
                        profileId: { $first: "$profileId" },
                        author: { $first: "$author" },
                        cid: { $first: "$cid" },
                        commentsAdded: { $sum: "$commentsAdded" },
                        repliesAdded: { $sum: "$repliesAdded" },
                        likesGiven: { $sum: "$likesGiven" },
                        sharesGiven: { $sum: "$sharesGiven" },
                        likesReceived: { $sum: "$likesReceived" },
                        repliesReceived: { $sum: "$repliesReceived" },
                        toxicityScoreAvg: { $avg: "$toxicityScoreAvg" },
                        postsViewed: { $sum: "$postsViewed" }
                    }
                },
                {
                    $lookup: {
                        from: 'profiles',
                        let: { authorId: "$author", clientCid: "$cid" },
                        pipeline: [
                            { 
                                $match: { 
                                    $expr: { 
                                        $and: [ 
                                            { $eq: ["$author", "$$authorId"] },
                                            { $eq: ["$cid", "$$clientCid"] }
                                        ] 
                                    }
                                }
                            },
                            { $project: { name: 1, picture: 1, _id: 0 } }
                        ],
                        as: 'profile'
                    }
                },
                { $unwind: { path: "$profile", preserveNullAndEmptyArrays: true } },
                { $sort: sortCriteria },
                {
                    $facet: {
                        profiles: [
                            { $skip: skip },
                            { $limit: limitValue }
                        ],
                        pagination: [
                            { $count: 'totalItems' }
                        ]
                    }
                }
            ]).allowDiskUse(true),
            ModelToUse.aggregate([
                { $match: matchFilter },
                {
                    $group: {
                        _id: dateTruncExpression,
                        commentsAdded: { $sum: "$commentsAdded" },
                        likesGiven: { $sum: "$likesGiven" },
                        repliesAdded: { $sum: "$repliesAdded" }
                    }
                },
                { $sort: { _id: 1 } },
                { $project: { _id: 0, date: "$_id", commentsAdded: 1, likesGiven: 1, repliesAdded: 1 } }
            ])
        ]);

        const profiles = aggregation[0].profiles;
        const totalItems = aggregation[0].pagination[0]?.totalItems || 0;
        const totalPages = Math.ceil(totalItems / limitValue);

        res.status(200).json({
            success: true,
            profiles,
            timeSeries: timeSeriesData,
            pagination: {
                totalItems,
                totalPages,
                currentPage: parseInt(page),
                itemsPerPage: limitValue
            }
        });

    } catch (error) {
        console.error('Error fetching profile analytics:', error);
        next(error);
    }
};

exports.getModerationAnalytics = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const userRole = req.user.role;
        const { cid, dateFrom, dateTo, provider, taskType } = req.query;

        let cidsToUse;
        try {
            cidsToUse = await getFilterCids(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: e.message });
        }

        const { dateFrom: from, dateTo: to } = getValidDateRange(dateFrom, dateTo);

        const matchFilter = {
            clientId: { $in: cidsToUse },
            timestamp: { $gte: from, $lte: to }
        };
        if (provider && provider !== 'all') {
            matchFilter.provider = provider;
        }
        if (taskType && taskType !== 'all') {
            matchFilter.taskType = taskType;
        }

        const [totalsResult, timeSeries, byProvider, byTask] = await Promise.all([
            TokenUsageStats.aggregate([
                { $match: matchFilter },
                {
                    $group: {
                        _id: null,
                        totalTokens: { $sum: "$totalTokens" },
                        promptTokens: { $sum: "$promptTokens" },
                        completionTokens: { $sum: "$completionTokens" }
                    }
                }
            ]),
            TokenUsageStats.aggregate([
                { $match: matchFilter },
                {
                    $group: {
                        _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
                        totalTokens: { $sum: "$totalTokens" },
                        promptTokens: { $sum: "$promptTokens" },
                        completionTokens: { $sum: "$completionTokens" }
                    }
                },
                { $sort: { _id: 1 } },
                { $project: { _id: 0, date: "$_id", totalTokens: 1, promptTokens: 1, completionTokens: 1 } }
            ]),
            TokenUsageStats.aggregate([
                { $match: matchFilter },
                {
                    $group: {
                        _id: "$provider",
                        totalTokens: { $sum: "$totalTokens" }
                    }
                }
            ]),
            TokenUsageStats.aggregate([
                { $match: matchFilter },
                {
                    $group: {
                        _id: "$taskType",
                        totalTokens: { $sum: "$totalTokens" }
                    }
                }
            ])
        ]);

        const totals = totalsResult[0] || { totalTokens: 0, promptTokens: 0, completionTokens: 0 };

        res.status(200).json({
            success: true,
            totals,
            timeSeries,
            byProvider,
            byTask
        });

    } catch (error) {
        console.error('Error fetching moderation analytics:', error);
        next(error);
    }
};

exports.getUserReputationLogs = async (req, res, next) => {
    try {
        const { author } = req.params;
        const { cid, page = 1, limit = 10 } = req.query;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!cid) return res.status(400).json({ success: false, error: 'CID required' });

        try {
            await getFilterCids(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: e.message });
        }

        const profile = await Profile.findOne({ author, cid }).select('_id trust');
        if (!profile) return res.status(404).json({ success: false, error: 'Profile not found' });

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const [logs, total] = await Promise.all([
            ReputationLog.find({ target_profile_id: profile._id })
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            ReputationLog.countDocuments({ target_profile_id: profile._id })
        ]);

        res.status(200).json({
            success: true,
            data: {
                currentScore: profile.trust?.score || 0,
                currentLevel: profile.trust?.level || 0,
                logs,
                pagination: {
                    totalItems: total,
                    totalPages: Math.ceil(total / limitNum),
                    currentPage: pageNum,
                    itemsPerPage: limitNum
                }
            }
        });

    } catch (error) {
        console.error('Error fetching reputation logs:', error);
        next(error);
    }
};

exports.getTopUsersByComments = async (req, res, next) => {
    
};