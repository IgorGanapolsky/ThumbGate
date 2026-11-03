#!/usr/bin/env node
'use strict';

// One three-hour block, one job: checkout close.
// Inbox, social, and screenshot work waits until the block ends.
// A missing or corrupt block file allows the tool call.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BLOCK_MS = 3 * 60 * 60 * 1000;
const OBJECTIVE = 'checkout-close';

const GROWTH = new Set([
  'checkout-close',
  'checkout-pay-link',
  'cancel-page-recovery',
  'billing-read',
]);

const INTERRUPT = new Set([
  'inbox-reply',
  'inbox-restore',
  'social-post',
  'screenshot-triage',
  'viral-post',
]);

const URGENT = new Set([
  'production-outage',
  'security-incident',
  'spend-block',
]);

function defaultBlockPath() {
  if (process.env.THUMBGATE_FOCUS_BLOCK_PATH) return process.env.THUMBGATE_FOCUS_BLOCK_PATH;
  return path.join(os.homedir(), '.thumbgate', 'focus-block.json');
}

function normalizeBlock(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.objective !== OBJECTIVE) return null;
  const startedMs = Date.parse(parsed.startedAt);
  if (!Number.isFinite(startedMs)) return null;
  let blockMs = Number(parsed.blockMs);
  if (!Number.isFinite(blockMs) || blockMs <= 0) blockMs = BLOCK_MS;
  if (blockMs > BLOCK_MS) blockMs = BLOCK_MS;
  return {
    objective: OBJECTIVE,
    startedAt: new Date(startedMs).toISOString(),
    blockMs,
  };
}

function loadBlock(blockPath) {
  const target = blockPath || defaultBlockPath();
  let raw;
  try {
    raw = fs.readFileSync(target, 'utf8');
  } catch {
    return null;
  }
  try {
    return normalizeBlock(JSON.parse(raw));
  } catch {
    return null;
  }
}

function evaluateFocusBlock({ now, block, kind }) {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs) || typeof kind !== 'string' || !kind) {
    return { decision: 'allow', reason: 'missing-clock-or-action' };
  }
  const normalized = normalizeBlock(block);
  if (!normalized) return { decision: 'allow', reason: 'no-block', kind };
  const startedMs = Date.parse(normalized.startedAt);
  const endsMs = startedMs + normalized.blockMs;
  if (nowMs < startedMs || nowMs >= endsMs) {
    return { decision: 'allow', reason: 'outside-block', kind };
  }
  if (URGENT.has(kind)) {
    return { decision: 'allow', reason: 'urgent', kind, objective: OBJECTIVE };
  }
  if (GROWTH.has(kind)) {
    return { decision: 'allow', reason: 'growth-job', kind, objective: OBJECTIVE };
  }
  if (INTERRUPT.has(kind)) {
    const resumeAt = new Date(endsMs).toISOString();
    return {
      decision: 'wait',
      reason: `Focus block until ${resumeAt}: ${kind} waits. The job in this block is checkout close.`,
      kind,
      objective: OBJECTIVE,
      resumeAt,
    };
  }
  return { decision: 'allow', reason: 'unclassified', kind };
}

function toolText(toolName, toolInput) {
  const parts = [];
  if (toolName) parts.push(String(toolName));
  if (typeof toolInput === 'string') parts.push(toolInput);
  else if (toolInput && typeof toolInput === 'object') {
    for (const key of ['command', 'cmd', 'file_path', 'path', 'url', 'uri']) {
      if (typeof toolInput[key] === 'string') parts.push(toolInput[key]);
    }
  }
  return parts.join('\n');
}

function classifyToolCall(toolName, toolInput) {
  const text = toolText(toolName, toolInput);
  if (/production-outage|security-incident|spend-block/.test(text)) return 'security-incident';
  if (/\/v1\/billing\/summary/.test(text)) return 'billing-read';
  if (/\/checkout\/cancel/.test(text)) return 'cancel-page-recovery';
  if (/\/go\/pro-direct/.test(text)) return 'checkout-pay-link';
  if (/scripts\/focus-block\.js/.test(text)) return 'checkout-close';
  if (/fo-thumbgate-inbox/.test(text)) return 'inbox-reply';
  if (/post-everywhere|scripts\/post-to-|social-reply-monitor/.test(text)) return 'social-post';
  if (/Screenshot|\/screenshots\//.test(text)) return 'screenshot-triage';
  return null;
}

function decideToolCall({ now, toolName, toolInput, block, blockPath }) {
  const kind = classifyToolCall(toolName, toolInput);
  if (!kind) return { decision: 'allow', reason: 'unclassified' };
  const resolved = block === undefined ? loadBlock(blockPath) : block;
  return evaluateFocusBlock({ now, block: resolved, kind });
}

function startBlock({ now, blockPath, blockMs } = {}) {
  const record = normalizeBlock({
    startedAt: now || new Date().toISOString(),
    objective: OBJECTIVE,
    blockMs: blockMs || BLOCK_MS,
  });
  if (!record) {
    throw new Error('focus block start needs a clock');
  }
  const target = blockPath || defaultBlockPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  return record;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function mainCli(argv) {
  const cmd = argv[2] || 'status';
  const now = new Date().toISOString();
  if (cmd === 'start') {
    print(startBlock({ now }));
    return;
  }
  if (cmd === 'check') {
    const kindFlag = argv.indexOf('--kind');
    const kind = kindFlag >= 0 ? argv[kindFlag + 1] : '';
    print(evaluateFocusBlock({ now, block: loadBlock(), kind }));
    return;
  }
  print(evaluateFocusBlock({ now, block: loadBlock(), kind: 'inbox-reply' }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  mainCli(process.argv);
}

module.exports = {
  BLOCK_MS,
  OBJECTIVE,
  GROWTH,
  INTERRUPT,
  URGENT,
  defaultBlockPath,
  normalizeBlock,
  loadBlock,
  evaluateFocusBlock,
  classifyToolCall,
  decideToolCall,
  startBlock,
};
