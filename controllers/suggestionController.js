/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { runSuggestions } = require('@quelora/common/services/suggestService');

exports.triggerSuggestionJob = async (req, res) => {
    const { targetUserId } = req.body; // Opcional: Recalcular solo para un usuario

    // Respondemos rápido al cliente, el proceso corre en background
    res.status(200).json({ 
        status: 'ok', 
        message: targetUserId 
            ? `Suggestion recalculation started for user ${targetUserId}` 
            : 'Global suggestion recalculation started in background.'
    });

    // Ejecutar sin await para no bloquear la request HTTP
    runSuggestions(targetUserId).catch(err => {
        console.error('Manual trigger error:', err);
    });
};