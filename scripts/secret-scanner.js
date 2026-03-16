#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const MAX_SCAN_BYTES = 256 * 1024;
const SONAR_COMMAND = 'sonar';
let cachedSonarInstalled;

const SECRET_PATTERNS = [
  { id: 'anthropic_api_key', label: 'Anthropic API key', regex: /\bsk-ant-[a-z0-9_-]{20,}\b/gi },
  { id: 'openai_api_key', label: 'OpenAI API key', regex: /\bsk-[A-Za-z0-9]{24,}\b/g },
  { id: 'github_pat', label: 'GitHub personal access token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { id: 'github_fine_grained_pat', label: 'GitHub fine-grained token', regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { id: 'stripe_live_secret', label: 'Stripe live secret key', regex: /\bsk_live_[A-Za-z0-9]{16,}\b/g },
  { id: 'slack_token', label: 'Slack token', regex: /\bxox(?:a|b|p|r|s)-[A-Za-z0-9-]{10,}\b/g },
  { id: 'aws_access_key', label: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'jwt_token', label: 'JWT token', regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/g },
  { id: 'pem_private_key', label: 'Private key block', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  {
    id: 'generic_assignment',
    label: 'Likely secret assignment',
    regex: /\b(?:api[_-]?key|secret|token|access[_-]?token|password|passwd|client[_-]?secret)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}["']?/gi,
  },
];

const SECRET_FILE_PATTERNS = [
  { id: 'env_file', label: 'environment file', regex: /(^|\/)\.env(?:\.[^/]+)?$/i },
  { id: 'netrc_file', label: 'netrc credentials file', regex: /(^|\/)\.netrc$/i },
  { id: 'npmrc_file', label: 'npm credentials file', regex: /(^|\/)\.npmrc$/i },
  { id: 'pypirc_file', label: 'Python package credentials file', regex: /(^|\/)\.pypirc$/i },
  { id: 'ssh_private_key', label: 'SSH private key', regex: /(^|\/)(?:id_rsa|id_ed25519|id_dsa)$/i },
  { id: 'pem_key_file', label: 'PEM key file', regex: /\.pem$/i },
];

const BASH_SECRET_READ_PREFIXES = [
  'cat',
  'less',
  'more',
  'head',
  'tail',
  'grep',
  'rg',
  'sed',
  'awk',
  'cut',
  'sort',
  'uniq',
  'strings',
  'env',
  'printenv',
];

const EDIT_LIKE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

function redactText(text) {
  if (!text) return '';
  let redacted = String(text);
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern.regex, `[REDACTED:${pattern.id}]`);
  }
  return redacted;
}

function hashText(text) {
  if (!text) return null;
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function computeLineNumber(text, index) {
  const prefix = text.slice(0, index);
  return prefix.split('\n').length;
}

function uniqueFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = [
      finding.id,
      finding.line || '',
      finding.path || '',
      finding.source || '',
      finding.reason || '',
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasSonarInstalled() {
  if (cachedSonarInstalled !== undefined) {
    return cachedSonarInstalled;
  }
  const status = spawnSync(SONAR_COMMAND, ['install', 'secrets', '--status'], {
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 5000,
  });
  cachedSonarInstalled = status.status === 0;
  return cachedSonarInstalled;
}

function resolveProvider(provider) {
  const configured = String(provider || process.env.RLHF_SECRET_SCAN_PROVIDER || 'heuristic').trim().toLowerCase();
  if (configured === 'sonar') return 'sonar';
  if (configured === 'heuristic') return 'heuristic';
  if (configured === 'off') return 'off';
  const allowAutoSonar = process.env.RLHF_SECRET_SCAN_AUTO_SONAR === '1';
  return allowAutoSonar && hasSonarInstalled() ? 'sonar' : 'heuristic';
}

function parseSonarOutput(output, source) {
  const text = String(output || '').trim();
  if (!text) return [];
  const lines = text.split('\n').filter(Boolean);
  return lines.map((line, index) => ({
    id: 'sonar_secret_detection',
    label: 'Sonar secret detection',
    source,
    line: index + 1,
    reason: redactText(line).slice(0, 240),
  }));
}

function sonarScanText(text) {
  const result = spawnSync(SONAR_COMMAND, ['analyze', 'secrets', '--stdin'], {
    input: text,
    stdio: 'pipe',
    encoding: 'utf8',
    maxBuffer: MAX_SCAN_BYTES * 2,
    timeout: 10000,
  });
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  const findings = parseSonarOutput(combined, 'prompt');
  return {
    detected: findings.length > 0,
    provider: 'sonar',
    findings,
    raw: combined,
  };
}

function sonarScanFile(filePath) {
  const result = spawnSync(SONAR_COMMAND, ['analyze', 'secrets', '--file', filePath], {
    stdio: 'pipe',
    encoding: 'utf8',
    maxBuffer: MAX_SCAN_BYTES * 2,
    timeout: 10000,
  });
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  const findings = parseSonarOutput(combined, 'file').map((finding) => ({
    ...finding,
    path: filePath,
  }));
  return {
    detected: findings.length > 0,
    provider: 'sonar',
    findings,
    raw: combined,
  };
}

function heuristicScanText(text, source = 'text') {
  const input = String(text || '');
  const findings = [];
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match = pattern.regex.exec(input);
    while (match) {
      findings.push({
        id: pattern.id,
        label: pattern.label,
        source,
        line: computeLineNumber(input, match.index),
        reason: `${pattern.label} detected`,
      });
      match = pattern.regex.exec(input);
    }
  }
  return {
    detected: findings.length > 0,
    provider: 'heuristic',
    findings: uniqueFindings(findings),
  };
}

function classifySecretPath(filePath) {
  const normalized = String(filePath || '').trim();
  if (!normalized) return null;
  for (const pattern of SECRET_FILE_PATTERNS) {
    if (pattern.regex.test(normalized)) {
      return {
        id: pattern.id,
        label: pattern.label,
        path: normalized,
        source: 'path',
        reason: `${pattern.label} access requested`,
      };
    }
  }
  return null;
}

function safeReadFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_SCAN_BYTES) {
      return null;
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function scanText(text, options = {}) {
  const provider = resolveProvider(options.provider);
  if (provider === 'off') {
    return { detected: false, provider: 'off', findings: [] };
  }
  if (provider === 'sonar') {
    try {
      const result = sonarScanText(text);
      if (result.detected) return result;
    } catch {
      // Fall back to heuristic detection.
    }
  }
  return heuristicScanText(text, options.source || 'text');
}

function scanFile(filePath, options = {}) {
  const pathFinding = classifySecretPath(filePath);
  const provider = resolveProvider(options.provider);
  const findings = [];
  if (pathFinding) findings.push(pathFinding);

  const fileContent = safeReadFile(filePath);
  if (fileContent) {
    if (provider === 'sonar') {
      try {
        const result = sonarScanFile(filePath);
        if (result.detected) {
          findings.push(...result.findings);
        }
      } catch {
        const fallback = heuristicScanText(fileContent, 'file');
        findings.push(...fallback.findings.map((finding) => ({ ...finding, path: filePath })));
      }
    } else {
      const result = heuristicScanText(fileContent, 'file');
      findings.push(...result.findings.map((finding) => ({ ...finding, path: filePath })));
    }
  }

  return {
    detected: findings.length > 0,
    provider,
    findings: uniqueFindings(findings),
    fileHash: fileContent ? hashText(fileContent) : null,
  };
}

function tokenizeCommand(command) {
  const tokens = [];
  const regex = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let match = regex.exec(String(command || ''));
  while (match) {
    tokens.push(match[1] || match[2] || match[3]);
    match = regex.exec(String(command || ''));
  }
  return tokens;
}

function looksLikePath(token) {
  if (!token) return false;
  if (token.startsWith('-')) return false;
  if (token.includes('://')) return false;
  return token.includes('/') || token.startsWith('.') || token.startsWith('~') || token.startsWith('..');
}

function resolvePathToken(token, cwd) {
  const normalized = String(token || '').trim();
  if (!normalized) return null;
  if (normalized.startsWith('~')) {
    return path.join(os.homedir(), normalized.slice(1));
  }
  if (path.isAbsolute(normalized)) return normalized;
  return path.join(cwd || process.cwd(), normalized);
}

function scanBashCommand(command, options = {}) {
  const cwd = options.cwd || process.cwd();
  const findings = [];
  const inlineScan = scanText(command, { provider: options.provider, source: 'command' });
  findings.push(...inlineScan.findings.map((finding) => ({
    ...finding,
    reason: `${finding.label} found in command text`,
  })));

  const tokens = tokenizeCommand(command);
  const verb = String(tokens[0] || '').toLowerCase();
  const inspectsFiles = BASH_SECRET_READ_PREFIXES.includes(verb);

  if (inspectsFiles) {
    for (const token of tokens.slice(1)) {
      if (!looksLikePath(token)) continue;
      const resolved = resolvePathToken(token, cwd);
      const fileScan = scanFile(resolved, { provider: options.provider });
      if (!fileScan.detected) continue;
      findings.push(...fileScan.findings.map((finding) => ({
        ...finding,
        source: 'command_file',
      })));
    }
  }

  return {
    detected: findings.length > 0,
    provider: inlineScan.provider,
    findings: uniqueFindings(findings),
    commandHash: hashText(command),
  };
}

function getToolInputPaths(toolInput = {}, cwd = process.cwd()) {
  const candidates = [
    toolInput.file_path,
    toolInput.path,
    toolInput.filePath,
    toolInput.target_path,
  ].filter(Boolean);
  return candidates.map((candidate) => resolvePathToken(candidate, cwd));
}

function scanHookInput(input = {}, options = {}) {
  const toolName = String(input.tool_name || input.toolName || '').trim();
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const cwd = input.cwd || options.cwd || process.cwd();
  const findings = [];
  let provider = resolveProvider(options.provider);
  let commandHash = null;
  let fileHashes = [];

  const contentFields = [
    toolInput.content,
    toolInput.new_string,
    toolInput.value,
    toolInput.text,
  ].filter((value) => typeof value === 'string' && value.trim());

  if (!EDIT_LIKE_TOOLS.has(toolName)) {
    const paths = getToolInputPaths(toolInput, cwd);
    for (const filePath of paths) {
      const result = scanFile(filePath, { provider });
      if (result.detected) {
        provider = result.provider;
        fileHashes.push(result.fileHash);
        findings.push(...result.findings);
      }
    }
  }

  if (typeof toolInput.command === 'string' && toolInput.command.trim()) {
    const result = scanBashCommand(toolInput.command, { provider, cwd });
    if (result.detected) {
      provider = result.provider;
      commandHash = result.commandHash;
      findings.push(...result.findings);
    }
  }

  for (const content of contentFields) {
    const result = scanText(content, { provider, source: 'tool_input' });
    if (result.detected) {
      provider = result.provider;
      findings.push(...result.findings);
    }
  }

  return {
    detected: findings.length > 0,
    provider,
    toolName,
    findings: uniqueFindings(findings),
    commandHash,
    fileHashes: fileHashes.filter(Boolean),
  };
}

function buildSafeSummary(findings, prefix) {
  const labels = [...new Set(findings.map((finding) => finding.label || finding.id))];
  return `${prefix}: ${labels.join(', ')}`;
}

module.exports = {
  SECRET_PATTERNS,
  SECRET_FILE_PATTERNS,
  redactText,
  resolveProvider,
  scanText,
  scanFile,
  scanBashCommand,
  scanHookInput,
  classifySecretPath,
  buildSafeSummary,
  tokenizeCommand,
};
