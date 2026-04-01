#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Computer-Use Action Firewall — normalizes OpenAI Responses API
 * computer-environment actions into ThumbGate's gate schema and
 * evaluates them against policy presets.
 */

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'gates', 'computer-use.json');

// Action types from Responses API computer environment
const ACTION_TYPES = {
  'browser.open': { category: 'browser', riskLevel: 'low' },
  'browser.click': { category: 'browser', riskLevel: 'low' },
  'browser.type': { category: 'browser', riskLevel: 'medium' },
  'shell.exec': { category: 'shell', riskLevel: 'high' },
  'file.read': { category: 'file', riskLevel: 'low' },
  'file.write': { category: 'file', riskLevel: 'medium' },
  'file.delete': { category: 'file', riskLevel: 'high' },
  'clipboard.read': { category: 'system', riskLevel: 'medium' },
  'clipboard.write': { category: 'system', riskLevel: 'medium' },
  'download': { category: 'network', riskLevel: 'medium' },
  'upload': { category: 'network', riskLevel: 'high' },
  'message.send': { category: 'communication', riskLevel: 'high' },
};

// Policy presets
const PRESETS = {
  'safe-readonly': {
    allow: ['browser.open', 'browser.click', 'file.read', 'clipboard.read'],
    deny: ['shell.exec', 'file.write', 'file.delete', 'upload', 'message.send'],
    requireApproval: ['browser.type', 'download', 'clipboard.write'],
  },
  'dev-sandbox': {
    allow: ['browser.open', 'browser.click', 'browser.type', 'file.read', 'file.write', 'clipboard.read', 'clipboard.write', 'download'],
    deny: ['upload', 'message.send'],
    requireApproval: ['shell.exec', 'file.delete'],
  },
  'human-approval-for-write': {
    allow: ['browser.open', 'browser.click', 'file.read', 'clipboard.read'],
    deny: [],
    requireApproval: ['browser.type', 'shell.exec', 'file.write', 'file.delete', 'clipboard.write', 'download', 'upload', 'message.send'],
  },
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeAction(rawAction) {
  if (!rawAction || typeof rawAction !== 'object') {
    return {
      type: 'unknown',
      category: 'unknown',
      riskLevel: 'high',
      target: '',
      args: {},
      timestamp: new Date().toISOString(),
    };
  }

  const type = rawAction.type || rawAction.action || 'unknown';
  const meta = ACTION_TYPES[type] || { category: 'unknown', riskLevel: 'high' };

  return {
    type,
    category: meta.category,
    riskLevel: meta.riskLevel,
    target: rawAction.target || rawAction.url || rawAction.path || rawAction.command || '',
    args: rawAction.args || rawAction.params || {},
    timestamp: rawAction.timestamp || new Date().toISOString(),
  };
}

function buildRegex(pattern) {
  // Handle (?i) inline flag by converting to JS 'i' flag
  if (pattern.startsWith('(?i)')) {
    return new RegExp(pattern.slice(4), 'i');
  }
  return new RegExp(pattern);
}

function matchesDangerousPattern(action) {
  const config = loadConfig();
  if (!config || !Array.isArray(config.dangerousShellPatterns)) return null;
  if (action.type !== 'shell.exec') return null;

  const command = action.target || '';
  for (const pattern of config.dangerousShellPatterns) {
    try {
      if (buildRegex(pattern).test(command)) {
        return pattern;
      }
    } catch {
      // skip invalid regex
    }
  }
  return null;
}

function matchesSecretPattern(action) {
  const config = loadConfig();
  if (!config || !Array.isArray(config.secretPatterns)) return null;
  if (action.type !== 'file.write' && action.type !== 'browser.type') return null;

  const content = action.args.content || action.args.text || action.target || '';
  for (const pattern of config.secretPatterns) {
    try {
      if (buildRegex(pattern).test(content)) {
        return pattern;
      }
    } catch {
      // skip invalid regex
    }
  }
  return null;
}

function evaluateAction(action, preset = 'dev-sandbox', customRules = []) {
  const normalized = action.type ? action : normalizeAction(action);
  const presetConfig = PRESETS[preset];
  if (!presetConfig) {
    return {
      decision: 'deny',
      reason: `Unknown preset: ${preset}`,
      preset,
      riskLevel: normalized.riskLevel,
      auditEntry: createAuditEntry(normalized, { decision: 'deny', reason: `Unknown preset: ${preset}`, preset }),
    };
  }

  // Custom rules override preset defaults
  for (const rule of customRules) {
    if (rule.action === normalized.type) {
      const decision = rule.decision || 'deny';
      const reason = rule.reason || `Custom rule override for ${normalized.type}`;
      return {
        decision,
        reason,
        preset,
        riskLevel: normalized.riskLevel,
        auditEntry: createAuditEntry(normalized, { decision, reason, preset }),
      };
    }
  }

  // Check dangerous shell patterns (always deny)
  const dangerousMatch = matchesDangerousPattern(normalized);
  if (dangerousMatch) {
    return {
      decision: 'deny',
      reason: `Dangerous shell pattern detected: ${dangerousMatch}`,
      preset,
      riskLevel: 'critical',
      auditEntry: createAuditEntry(normalized, { decision: 'deny', reason: `Dangerous shell pattern: ${dangerousMatch}`, preset }),
    };
  }

  // Check secret patterns (always deny)
  const secretMatch = matchesSecretPattern(normalized);
  if (secretMatch) {
    return {
      decision: 'deny',
      reason: `Secret pattern detected in content: ${secretMatch}`,
      preset,
      riskLevel: 'critical',
      auditEntry: createAuditEntry(normalized, { decision: 'deny', reason: `Secret pattern: ${secretMatch}`, preset }),
    };
  }

  // Evaluate against preset
  if (presetConfig.deny.includes(normalized.type)) {
    return {
      decision: 'deny',
      reason: `Action ${normalized.type} denied by ${preset} preset`,
      preset,
      riskLevel: normalized.riskLevel,
      auditEntry: createAuditEntry(normalized, { decision: 'deny', reason: `Denied by preset`, preset }),
    };
  }

  if (presetConfig.requireApproval.includes(normalized.type)) {
    return {
      decision: 'require-approval',
      reason: `Action ${normalized.type} requires approval in ${preset} preset`,
      preset,
      riskLevel: normalized.riskLevel,
      auditEntry: createAuditEntry(normalized, { decision: 'require-approval', reason: `Requires approval`, preset }),
    };
  }

  if (presetConfig.allow.includes(normalized.type)) {
    return {
      decision: 'allow',
      reason: `Action ${normalized.type} allowed by ${preset} preset`,
      preset,
      riskLevel: normalized.riskLevel,
      auditEntry: createAuditEntry(normalized, { decision: 'allow', reason: `Allowed by preset`, preset }),
    };
  }

  // Default: unknown actions require approval
  return {
    decision: 'require-approval',
    reason: `Action ${normalized.type} not in preset; defaulting to require-approval`,
    preset,
    riskLevel: normalized.riskLevel,
    auditEntry: createAuditEntry(normalized, { decision: 'require-approval', reason: `Not in preset`, preset }),
  };
}

function createAuditEntry(action, decision) {
  return {
    timestamp: action.timestamp || new Date().toISOString(),
    actionType: action.type,
    target: action.target || '',
    decision: decision.decision,
    reason: decision.reason,
    preset: decision.preset || 'unknown',
  };
}

function evaluateBatch(actions, preset = 'dev-sandbox') {
  return actions.map((rawAction) => {
    const normalized = normalizeAction(rawAction);
    return evaluateAction(normalized, preset);
  });
}

module.exports = {
  ACTION_TYPES,
  PRESETS,
  CONFIG_PATH,
  normalizeAction,
  evaluateAction,
  createAuditEntry,
  evaluateBatch,
  loadConfig,
  matchesDangerousPattern,
  matchesSecretPattern,
};
