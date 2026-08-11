'use strict';

/**
 * NVIDIA Nemotron + NeMo Switchyard adapter surface for ThumbGate.
 * Catalog/config only — no NVIDIA SDK required at runtime.
 */

const {
  describeNemotronLightning,
  routeAgentSteps,
  evaluateRoutingAlgorithm,
  buildAlwaysOnAgentPlan,
  DEFAULT_POOL,
} = require('../../scripts/switchyard-router');

const NEMOTRON_MODELS = Object.freeze({
  LIGHTNING_35: 'nemotron-3.5-lightning',
});

function buildNemotronConfig(options = {}) {
  const env = options.env || process.env;
  const apiKey = options.apiKey
    || env.NVIDIA_API_KEY
    || env.NGC_API_KEY
    || env.NIM_API_KEY
    || null;
  const baseUrl = options.baseUrl
    || env.NVIDIA_NIM_BASE_URL
    || env.NEMOTRON_BASE_URL
    || 'https://integrate.api.nvidia.com/v1';

  return {
    apiKey,
    baseUrl: String(baseUrl).replace(/\/+$/, ''),
    model: options.model || NEMOTRON_MODELS.LIGHTNING_35,
    isConfigured: Boolean(apiKey),
    isOpenAICompatible: true,
    lightning: describeNemotronLightning(),
  };
}

function planAlwaysOnAgent(options = {}) {
  const steps = buildAlwaysOnAgentPlan(options);
  return routeAgentSteps(steps, options);
}

module.exports = {
  NEMOTRON_MODELS,
  DEFAULT_POOL,
  buildNemotronConfig,
  planAlwaysOnAgent,
  routeAgentSteps,
  evaluateRoutingAlgorithm,
  describeNemotronLightning,
};
