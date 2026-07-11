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

const OUTBOUND_FILE_COMMANDS = new Set(['curl', 'wget']);
const OUTBOUND_COMMAND_WRAPPERS = new Set(['command', 'env', 'nohup', 'sudo']);
const CURL_DATA_FILE_OPTIONS = new Set([
  '-d',
  '--data',
  '--data-ascii',
  '--data-binary',
  '--data-urlencode',
  '--json',
]);
const CURL_FORM_FILE_OPTIONS = new Set(['-F', '--form']);
const CURL_UPLOAD_FILE_OPTIONS = new Set(['-T', '--upload-file']);
const WGET_POST_FILE_OPTIONS = new Set(['--post-file', '--body-file']);

const EDIT_LIKE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const SAFE_SECRET_STORAGE_DIRS = [
  '.resume_secrets',
  '.thumbgate/secrets',
  '.config/thumbgate',
];

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
  const configured = String(provider || process.env.THUMBGATE_SECRET_SCAN_PROVIDER || 'heuristic').trim().toLowerCase();
  if (configured === 'sonar') return 'sonar';
  if (configured === 'heuristic') return 'heuristic';
  if (configured === 'off') return 'off';
  const allowAutoSonar = process.env.THUMBGATE_SECRET_SCAN_AUTO_SONAR === '1';
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
      // Safe test key bypass
      const matchedString = match[0].toLowerCase();
      if (pattern.id === 'generic_assignment' && (matchedString.includes('sk_test_') || matchedString.includes('test_token'))) {
        match = pattern.regex.exec(input);
        continue;
      }
      
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
  const pathFinding = options.includePathFinding === false ? null : classifySecretPath(filePath);
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

function splitCommandSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (const char of String(command || '')) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ';' || char === '|' || char === '&' || char === '\n') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) segments.push(current.trim());
  return segments;
}

function isShellAssignment(token) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(String(token || ''));
}

function findOutboundCommand(tokens) {
  let index = 0;
  while (isShellAssignment(tokens[index])) index += 1;

  while (index < tokens.length) {
    const wrapper = path.basename(String(tokens[index] || '')).toLowerCase();
    if (!OUTBOUND_COMMAND_WRAPPERS.has(wrapper)) break;
    index += 1;
    if (wrapper === 'env') {
      while (isShellAssignment(tokens[index])) index += 1;
    }
    if (String(tokens[index] || '').startsWith('-')) return null;
  }

  const command = path.basename(String(tokens[index] || '')).toLowerCase();
  return OUTBOUND_FILE_COMMANDS.has(command) ? { command, index } : null;
}

function stripCurlFormMetadata(fileReference) {
  return String(fileReference || '').split(';', 1)[0];
}

function curlDataFileReference(value, allowNamedReference = false) {
  const normalized = String(value || '');
  if (normalized.startsWith('@')) return normalized.slice(1);
  if (!allowNamedReference) return null;
  const markerIndex = normalized.indexOf('@');
  return markerIndex > 0 ? normalized.slice(markerIndex + 1) : null;
}

function curlFormFileReference(value) {
  const normalized = String(value || '');
  const marker = normalized.match(/(?:^|=)[@<](.+)$/);
  return marker ? stripCurlFormMetadata(marker[1]) : null;
}

function addOutboundReference(references, fileReference, cwd, metadata) {
  const normalized = String(fileReference || '').trim();
  if (!normalized || normalized === '-') return;
  const resolvedPath = resolvePathToken(normalized, cwd);
  if (!resolvedPath) return;
  references.push({
    path: resolvedPath,
    ...metadata,
  });
}

function readOptionArgument(args, index, option) {
  const token = String(args[index] || '');
  if (token === option) {
    return { value: args[index + 1], consumesNext: true };
  }
  if (option.startsWith('--') && token.startsWith(`${option}=`)) {
    return { value: token.slice(option.length + 1), consumesNext: false };
  }
  if (option.length === 2 && token.startsWith(option) && token.length > 2) {
    return { value: token.slice(2), consumesNext: false };
  }
  return null;
}

function outboundOptionSpecs(command) {
  if (command === 'wget') {
    return [{
      options: WGET_POST_FILE_OPTIONS,
      fileReference: (value) => value,
    }];
  }
  return [
    {
      options: CURL_DATA_FILE_OPTIONS,
      fileReference: (value, option) => curlDataFileReference(value, option === '--data-urlencode'),
    },
    {
      options: CURL_FORM_FILE_OPTIONS,
      fileReference: curlFormFileReference,
    },
    {
      options: CURL_UPLOAD_FILE_OPTIONS,
      fileReference: (value) => value,
    },
  ];
}

function extractCommandFileReferences(command, args, cwd, references) {
  const specs = outboundOptionSpecs(command);
  for (let index = 0; index < args.length; index += 1) {
    let matched = false;
    for (const spec of specs) {
      for (const option of spec.options) {
        const argument = readOptionArgument(args, index, option);
        if (!argument) continue;
        addOutboundReference(references, spec.fileReference(argument.value, option), cwd, {
          command,
          option,
        });
        if (argument.consumesNext) index += 1;
        matched = true;
        break;
      }
      if (matched) break;
    }
  }
}

function extractOutboundFileReferences(command, cwd = process.cwd()) {
  // Only file-bearing client options enter this path. Endpoint-only egress
  // remains governed by the existing warn-level network gate.
  const references = [];
  for (const segment of splitCommandSegments(command)) {
    const tokens = tokenizeCommand(segment);
    const outboundCommand = findOutboundCommand(tokens);
    if (!outboundCommand) continue;
    const args = tokens.slice(outboundCommand.index + 1);
    extractCommandFileReferences(outboundCommand.command, args, cwd, references);
  }

  const seen = new Set();
  return references.filter((reference) => {
    if (seen.has(reference.path)) return false;
    seen.add(reference.path);
    return true;
  });
}

function normalizePathForPolicy(filePath) {
  return path.resolve(String(filePath || '').replace(/^~(?=\/|$)/, os.homedir()));
}

function isSafeSecretStoragePath(filePath) {
  if (!filePath) return false;
  const normalized = normalizePathForPolicy(filePath);
  const home = normalizePathForPolicy(os.homedir());
  return SAFE_SECRET_STORAGE_DIRS.some((dir) => {
    const allowedRoot = path.join(home, dir);
    return normalized === allowedRoot || normalized.startsWith(`${allowedRoot}${path.sep}`);
  });
}

function isSafeSecretStorageWrite(toolName, toolInput = {}, cwd = process.cwd()) {
  if (!EDIT_LIKE_TOOLS.has(toolName)) return false;
  const paths = getToolInputPaths(toolInput, cwd);
  return paths.length > 0 && paths.every((filePath) => isSafeSecretStoragePath(filePath));
}

function scanBashCommand(command, options = {}) {
  const cwd = options.cwd || process.cwd();
  const findings = [];
  const fileHashes = [];
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

  if (inlineScan.provider !== 'off') {
    for (const reference of extractOutboundFileReferences(command, cwd)) {
      const fileScan = scanFile(reference.path, {
        provider: options.provider,
        includePathFinding: false,
      });
      if (!fileScan.detected) continue;
      findings.push(...fileScan.findings.map((finding) => ({
        ...finding,
        source: 'outbound_file',
        reason: `${finding.label} found in file referenced by ${reference.command} ${reference.option}`,
      })));
      if (fileScan.fileHash) fileHashes.push(fileScan.fileHash);
    }
  }

  const uniqueFileHashes = [...new Set(fileHashes)];

  return {
    detected: findings.length > 0,
    provider: inlineScan.provider,
    findings: uniqueFindings(findings),
    commandHash: hashText(command),
    fileHashes: uniqueFileHashes,
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
  const safeSecretStorageWrite = isSafeSecretStorageWrite(toolName, toolInput, cwd);

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
      fileHashes.push(...(result.fileHashes || []));
      findings.push(...result.findings);
    }
  }

  if (!safeSecretStorageWrite) {
    for (const content of contentFields) {
      const result = scanText(content, { provider, source: 'tool_input' });
      if (result.detected) {
        provider = result.provider;
        findings.push(...result.findings);
      }
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
  SAFE_SECRET_STORAGE_DIRS,
  EDIT_LIKE_TOOLS,
  redactText,
  resolveProvider,
  scanText,
  scanFile,
  scanBashCommand,
  scanHookInput,
  classifySecretPath,
  isSafeSecretStoragePath,
  isSafeSecretStorageWrite,
  buildSafeSummary,
  tokenizeCommand,
};
