'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_ITEM_LIMIT = 5;
const INDEXED_REPOS = new Set();
const CODE_PATH_PATTERN = /\b([A-Za-z0-9_./-]+\.(?:c|cc|cpp|cs|go|h|hpp|java|js|jsx|kt|mjs|php|py|rb|rs|sh|sql|swift|ts|tsx|yaml|yml))\b/g;
const CODE_KEYWORDS = [
  'api',
  'class',
  'code',
  'endpoint',
  'file',
  'function',
  'handler',
  'implementation',
  'method',
  'module',
  'refactor',
  'rename',
  'repo',
  'symbol',
  'test',
];
const STOPWORDS = new Set([
  'about',
  'after',
  'before',
  'change',
  'changes',
  'check',
  'code',
  'context',
  'current',
  'debug',
  'evidence',
  'file',
  'files',
  'fix',
  'impact',
  'intent',
  'line',
  'merge',
  'module',
  'path',
  'paths',
  'plan',
  'proof',
  'query',
  'refactor',
  'rename',
  'repo',
  'task',
  'tests',
  'tool',
  'verify',
  'workflow',
]);

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter(Boolean).map((value) => String(value).trim()).filter(Boolean)));
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function findGitRoot(startPath) {
  const cwd = path.resolve(startPath || process.cwd());
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    timeout: 2000,
  });

  if (result.status !== 0) {
    return null;
  }

  const resolved = String(result.stdout || '').trim();
  return resolved || null;
}

function resolveRepoPath(repoPath) {
  const raw = String(repoPath || '').trim();

  if (raw) {
    const resolved = path.resolve(raw);
    const existingTarget = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
      ? resolved
      : path.dirname(resolved);
    const root = findGitRoot(existingTarget);
    return root || existingTarget;
  }

  return findGitRoot(process.cwd()) || PROJECT_ROOT;
}

function looksLikeCodeWorkflow(options = {}) {
  if (options.repoPath) return true;

  const text = `${options.intentId || ''} ${options.context || ''}`.trim();
  if (!text) return false;
  if (CODE_PATH_PATTERN.test(text)) {
    CODE_PATH_PATTERN.lastIndex = 0;
    return true;
  }
  CODE_PATH_PATTERN.lastIndex = 0;

  const lower = text.toLowerCase();
  return CODE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function extractFileHints(context = '') {
  const matches = [];
  let match = CODE_PATH_PATTERN.exec(String(context || ''));
  while (match) {
    matches.push(match[1]);
    match = CODE_PATH_PATTERN.exec(String(context || ''));
  }
  CODE_PATH_PATTERN.lastIndex = 0;
  return uniqueStrings(matches).slice(0, DEFAULT_ITEM_LIMIT);
}

function pushSymbolCandidate(candidates, candidate) {
  const value = String(candidate || '').trim();
  if (!value) return;
  if (value.includes('/') || value.includes('\\')) return;
  if (STOPWORDS.has(value.toLowerCase())) return;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return;
  candidates.push(value);
}

function isCompoundPascalCaseToken(token) {
  const value = String(token || '').trim();
  if (!value || !/^[A-Z][A-Za-z0-9]*$/.test(value)) return false;

  let segmentCount = 1;
  for (let index = 1; index < value.length; index += 1) {
    const current = value[index];
    const previous = value[index - 1];
    if (/[A-Z]/.test(current) && /[a-z0-9]/.test(previous)) {
      segmentCount += 1;
    }
  }

  return segmentCount >= 2;
}

function extractSymbolHints(context = '') {
  const text = String(context || '');
  const candidates = [];

  for (const fileHint of extractFileHints(text)) {
    pushSymbolCandidate(candidates, path.basename(fileHint, path.extname(fileHint)));
  }

  for (const match of text.matchAll(/`([^`]+)`/g)) {
    pushSymbolCandidate(candidates, match[1]);
  }

  for (const match of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)(?=\s*\()/g)) {
    pushSymbolCandidate(candidates, match[1]);
  }

  for (const token of text.split(/[^A-Za-z0-9_]+/)) {
    if (isCompoundPascalCaseToken(token)) {
      pushSymbolCandidate(candidates, token);
    }
  }

  for (const match of text.matchAll(/\b([a-z][A-Za-z0-9_]{3,})\b/g)) {
    pushSymbolCandidate(candidates, match[1]);
  }

  return uniqueStrings(candidates).slice(0, 3);
}

function normalizeList(values, limit = DEFAULT_ITEM_LIMIT) {
  return uniqueStrings(values).slice(0, limit);
}

function parseGraphItems(output, limit = DEFAULT_ITEM_LIMIT) {
  const lines = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(info|warn|debug|trace)[:\s]/i.test(line))
    .filter((line) => !/^(analyzing|indexed|indexing|loaded|scanning)\b/i.test(line))
    .filter((line) => !/^(no\s+(callers|callees|dead))/i.test(line))
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean);

  return uniqueStrings(lines).slice(0, limit);
}

function getTimeoutMs(options = {}) {
  return parsePositiveInt(options.timeoutMs || process.env.RLHF_CODEGRAPH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
}

function isCodeGraphEnabled() {
  const disabled = String(process.env.RLHF_CODEGRAPH_DISABLED || '').toLowerCase();
  return disabled !== '1' && disabled !== 'true';
}

function shouldAutoIndex() {
  const raw = String(process.env.RLHF_CODEGRAPH_AUTO_INDEX || '').toLowerCase();
  if (!raw) return true;
  return raw !== '0' && raw !== 'false';
}

function getCodeGraphBin() {
  return process.env.RLHF_CODEGRAPH_BIN || 'cgc';
}

function runCodeGraph(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: getTimeoutMs(options),
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    throw new Error(stderr || `CodeGraphContext exited with status ${result.status}`);
  }

  return String(result.stdout || '').trim();
}

function ensureIndexed(bin, repoPath, options = {}) {
  if (!shouldAutoIndex()) return;
  if (INDEXED_REPOS.has(repoPath)) return;
  runCodeGraph(bin, ['index', '.'], { cwd: repoPath, timeoutMs: options.timeoutMs });
  INDEXED_REPOS.add(repoPath);
}

function parseStubImpact(input, context = {}) {
  if (!input) return null;
  let parsed = input;

  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch (_) {
      return null;
    }
  }

  return normalizeImpact({
    source: parsed.source || 'stub',
    repoPath: parsed.repoPath || context.repoPath,
    query: parsed.query || context.query,
    symbols: parsed.symbols || context.symbols,
    callers: parsed.callers,
    callees: parsed.callees,
    deadCode: parsed.deadCode || parsed.dead_code,
  });
}

function buildVerificationHints(impact) {
  const hints = [];
  const primarySymbol = impact.symbols[0];

  if (primarySymbol && impact.callers.length > 0) {
    hints.push(`Inspect upstream callers of ${primarySymbol} before merge.`);
  }
  if (primarySymbol && impact.callees.length > 0) {
    hints.push(`Exercise downstream dependencies touched by ${primarySymbol}.`);
  }
  if (impact.deadCode.length > 0) {
    hints.push('Review potential dead code before claiming the change is complete.');
  }

  return hints;
}

function summarizeImpact(impact) {
  const primarySymbol = impact.symbols[0];
  const segments = [];

  if (primarySymbol) {
    segments.push(`Focus symbol: ${primarySymbol}.`);
  }
  if (impact.callers.length > 0) {
    segments.push(`${impact.callers.length} caller path${impact.callers.length === 1 ? '' : 's'} to verify.`);
  }
  if (impact.callees.length > 0) {
    segments.push(`${impact.callees.length} downstream dependency path${impact.callees.length === 1 ? '' : 's'} touched.`);
  }
  if (impact.deadCode.length > 0) {
    segments.push(`${impact.deadCode.length} potential dead-code candidate${impact.deadCode.length === 1 ? '' : 's'} detected.`);
  }

  return segments.join(' ');
}

function normalizeImpact(raw = {}) {
  const symbols = normalizeList(raw.symbols);
  const callers = normalizeList(raw.callers);
  const callees = normalizeList(raw.callees);
  const deadCode = normalizeList(raw.deadCode);
  const impactScore = Math.min(10, (callers.length * 2) + callees.length + deadCode.length + symbols.length);

  const impact = {
    enabled: true,
    automated: true,
    source: raw.source || 'codegraphcontext',
    repoPath: raw.repoPath || null,
    query: raw.query || '',
    symbols,
    callers,
    callees,
    deadCode,
    hasImpact: symbols.length > 0 || callers.length > 0 || callees.length > 0 || deadCode.length > 0,
    evidence: {
      symbolCount: symbols.length,
      callerCount: callers.length,
      calleeCount: callees.length,
      deadCodeCount: deadCode.length,
      impactScore,
    },
  };

  impact.verificationHints = buildVerificationHints(impact);
  impact.summary = summarizeImpact(impact);
  return impact;
}

function unavailableImpact(context, reason) {
  return {
    enabled: false,
    automated: true,
    source: 'unavailable',
    repoPath: context.repoPath || null,
    query: context.query || '',
    symbols: context.symbols || [],
    callers: [],
    callees: [],
    deadCode: [],
    hasImpact: false,
    evidence: {
      symbolCount: (context.symbols || []).length,
      callerCount: 0,
      calleeCount: 0,
      deadCodeCount: 0,
      impactScore: 0,
    },
    verificationHints: [],
    summary: '',
    reason,
  };
}

function analyzeCodeGraphImpact(options = {}) {
  const rawQuery = String(options.context || options.query || '').trim();
  const rawRepoPath = String(options.repoPath || '').trim();
  const context = {
    intentId: options.intentId || '',
    query: rawQuery,
    repoPath: rawRepoPath ? resolveRepoPath(rawRepoPath) : null,
  };
  context.symbols = extractSymbolHints(context.query);

  if (!isCodeGraphEnabled()) {
    return unavailableImpact(context, 'Code graph analysis disabled');
  }

  if (!looksLikeCodeWorkflow({ intentId: context.intentId, context: context.query, repoPath: options.repoPath })) {
    return unavailableImpact(context, 'Task does not look like a coding workflow');
  }

  if (!context.repoPath) {
    context.repoPath = resolveRepoPath();
  }

  const stub = parseStubImpact(options.stubResponse || process.env.RLHF_CODEGRAPH_STUB_RESPONSE, context);
  if (stub) {
    return stub;
  }

  if (context.symbols.length === 0) {
    return unavailableImpact(context, 'No code symbols detected in task context');
  }

  const bin = getCodeGraphBin();
  try {
    ensureIndexed(bin, context.repoPath, options);

    const callers = [];
    const callees = [];
    for (const symbol of context.symbols.slice(0, 2)) {
      callers.push(...parseGraphItems(runCodeGraph(bin, ['analyze', 'callers', symbol], {
        cwd: context.repoPath,
        timeoutMs: options.timeoutMs,
      })));
      callees.push(...parseGraphItems(runCodeGraph(bin, ['analyze', 'calls', symbol], {
        cwd: context.repoPath,
        timeoutMs: options.timeoutMs,
      })));
    }

    const deadCode = parseGraphItems(runCodeGraph(bin, ['analyze', 'dead-code'], {
      cwd: context.repoPath,
      timeoutMs: options.timeoutMs,
    }));

    return normalizeImpact({
      source: 'codegraphcontext',
      repoPath: context.repoPath,
      query: context.query,
      symbols: context.symbols,
      callers,
      callees,
      deadCode,
    });
  } catch (err) {
    return unavailableImpact(context, err && err.message ? err.message : 'Code graph analysis failed');
  }
}

function formatCodeGraphRecallSection(impact) {
  if (!impact || !impact.enabled || !impact.hasImpact) {
    return '';
  }

  const lines = ['## Code Graph Impact', ''];
  if (impact.summary) {
    lines.push(impact.summary);
    lines.push('');
  }
  if (impact.symbols.length > 0) {
    lines.push(`Focus symbols: ${impact.symbols.join(', ')}`);
  }
  if (impact.callers.length > 0) {
    lines.push(`Upstream callers: ${impact.callers.join(' | ')}`);
  }
  if (impact.callees.length > 0) {
    lines.push(`Downstream dependencies: ${impact.callees.join(' | ')}`);
  }
  if (impact.deadCode.length > 0) {
    lines.push(`Potential dead code: ${impact.deadCode.join(' | ')}`);
  }
  if (impact.verificationHints.length > 0) {
    lines.push(`Verification focus: ${impact.verificationHints.join(' ')}`);
  }

  return lines.join('\n');
}

module.exports = {
  analyzeCodeGraphImpact,
  extractSymbolHints,
  formatCodeGraphRecallSection,
  isCodeGraphEnabled,
  looksLikeCodeWorkflow,
  resolveRepoPath,
};
