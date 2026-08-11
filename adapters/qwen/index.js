'use strict';

const MODEL_STUDIO_DEFAULT_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

const QWEN_MODELS = Object.freeze({
  QWEN_3_8_MAX: 'qwen3.8-max',
  QWEN_3_7_PLUS: 'qwen3.7-plus',
  QWEN_3_6_FLASH: 'qwen3.6-flash',
  QWEN_3_5_OMNI_PLUS: 'qwen3.5-omni-plus',
});

function buildQwenModelStudioConfig(options = {}) {
  const apiKey = options.apiKey || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || null;
  const baseUrl = options.baseUrl || process.env.DASHSCOPE_BASE_URL || MODEL_STUDIO_DEFAULT_BASE_URL;
  const model = options.model || QWEN_MODELS.QWEN_3_7_PLUS;

  return {
    apiKey,
    baseUrl,
    model,
    isConfigured: Boolean(apiKey),
    isOpenAICompatible: true,
  };
}

function validateQwenEgressGate(actionPayload = {}) {
  const url = String(actionPayload.url || actionPayload.endpoint || '');
  const isQwenEgress = /dashscope(-intl)?\.aliyuncs\.com/i.test(url);

  if (!isQwenEgress) {
    return { isMatch: false, action: 'allow' };
  }

  return {
    isMatch: true,
    action: actionPayload.hasBudgetApproval ? 'allow' : 'warn',
    reason: 'Auditing Qwen Model Studio egress for telemetry and cost control.',
  };
}

module.exports = {
  MODEL_STUDIO_DEFAULT_BASE_URL,
  QWEN_MODELS,
  buildQwenModelStudioConfig,
  validateQwenEgressGate,
};
