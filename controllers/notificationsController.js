/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const Profile = require('@quelora/common/models/Profile');
const webPush = require('web-push');
const { addPushJob } = require('@quelora/common/services/pushService');
const { addEmailJob } = require('@quelora/common/services/emailService');

exports.sendMail = async (req, res) => {
  try {
    const { cid, recipient, subject, body } = req.body;
    const author = req.user.author;

    if (!cid || !recipient || !subject || !body) {
      return res.status(400).json({ success: false, message: 'Missing required fields: cid, email, title or body'});
    }
    const job = await addEmailJob(cid, author, subject, body, recipient);
    console.log('📧 Email queued successfully:', { jobId: job.id, subjectMail: subject });

    return res.status(200).json({
      success: true,
      message: 'Email queued successfully',
      data: {
        jobId: job.id,
        status: 'queued'
      }
    });

  } catch (error) {
    console.error('❌ Error queueing email:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to queue email',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.sendNotification = async (req, res) => {
  try {
    const { cid, author, title, body, data } = req.body;

    if (!author) {
      console.warn('⚠️ Validation error: Author is required');
      return res.status(400).json({ error: 'author is required' });
    }

    if (!title || !body) {
      console.warn('⚠️ Validation error: Title and body are required');
      return res.status(400).json({ error: 'title and body are required' });
    }

    const job = await addPushJob(cid, author, title, body, data || {});
    console.log('🔔 Notification queued successfully:', { jobId: job.id });
    res.json({ success: true, message: 'Notification queued', jobId: job.id });

  } catch (error) {
    console.error('❌ Notification error:', error);
    res.status(500).json({ error: 'Failed to queue notification' });
  }
};

exports.searchAuthors = async (req, res) => {
  try {
    const { name } = req.query;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Search term must be at least 2 characters' });
    }

    const regex = new RegExp(name.trim(), 'i');

    const profiles = await Profile.find({
      pushSubscriptions: { $exists: true, $not: { $size: 0 } },
      $or: [
        { name: regex },
        { given_name: regex },
        { family_name: regex }
      ]
    })
    .sort({ name: 1 })
    .limit(20)
    .select('author name picture');

    res.json(profiles);
  } catch (error) {
    console.error('searchAuthors error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.generateVapidKeys = async (req, res) => {
  try {
    const vapidKeys = webPush.generateVAPIDKeys();
    console.log('🔑 VAPID credentials generated.');
    res.json({ publicKey: vapidKeys.publicKey, privateKey: vapidKeys.privateKey });
  } catch (error) {
    console.error('❌ Error generating VAPID keys:', error);
    res.status(500).json({ error: 'Failed to generate VAPID keys' });
  }
};