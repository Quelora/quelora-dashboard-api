/*
 * Quelora — quelora-dashboard-api
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { getClientConfig } = require('@quelora/common/services/clientConfigService');
const generateNolanAnalysisPrompt = require('../config/commentAnalysisNolanPromptConfig');

const GrokAnalysisProvider = require('@quelora/common/moderationProviders/GrokModerationProvider');
const OpenAIAnalysisProvider = require('@quelora/common/moderationProviders/OpenAIModerationProvider');
const GeminiAnalysisProvider = require('@quelora/common/moderationProviders/GeminiModerationProvider');
const DeepSeekAnalysisProvider = require('@quelora/common/moderationProviders/DeepSeekModerationProvider');

/**
 * Service to analyze user comments using the Nolan Chart framework.
 * Determines the user's position on economic and personal freedom axes.
 */
async function commentAnalysisNolanService(cid, comments) {
  let clientConfig;

  try {
    // Fetch base configuration
    clientConfig = await getClientConfig(cid, 'moderation');
    if (!clientConfig || typeof clientConfig !== 'object') {
      throw new Error('Invalid or missing client configuration.');
    }

    // Validate required properties
    if (!clientConfig.hasOwnProperty('enabled') || !clientConfig.hasOwnProperty('provider')) {
      throw new Error('Incomplete client configuration: missing required properties (enabled, provider).');
    }
  } catch (error) {
    console.error(`Error getting client configuration. cid ${cid}:`, error.message);
    return { analysis: null, reason: 'Error getting client configuration.' };
  }

  if (!clientConfig.enabled) {
    return { analysis: null, reason: 'Nolan analysis disabled.' };
  }

  // Select AI provider
  let provider;
  switch (clientConfig.provider) {
    case 'OpenAI':
      provider = new OpenAIAnalysisProvider(clientConfig.apiKey, clientConfig.configJson, cid);
      break;
    case 'Grok':
      provider = new GrokAnalysisProvider(clientConfig.apiKey, clientConfig.configJson, cid);
      break;
    case 'Gemini':
      provider = new GeminiAnalysisProvider(clientConfig.apiKey, clientConfig.configJson, cid);
      break;
    case 'Deep':
      provider = new DeepSeekAnalysisProvider(clientConfig.apiKey, clientConfig.configJson, cid);
      break;
    default:
      return { analysis: null, reason: `Provider not supported: ${clientConfig.provider}` };
  }

  // Generate the Nolan prompt
  const prompt = generateNolanAnalysisPrompt(comments);

  try {
    const result = await provider.analyze(prompt, 'nolan_analysis');


    return { analysis: JSON.parse(result), reason: null };
  } catch (error) {
    console.error(`Error analyzing with provider ${clientConfig.provider}:`, error.message);
    return { analysis: null, reason: 'Error analyzing with the provider.' };
  }
}

module.exports = { commentAnalysisNolanService };
