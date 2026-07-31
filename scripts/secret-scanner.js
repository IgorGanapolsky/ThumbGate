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
  { id: 'jwt_token', label: 'JWT token', regex: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g },
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
  // Do not match *.pub — public keys are routinely read for SSH setup.
  { id: 'ssh_private_key', label: 'SSH private key', regex: /(^|\/)(?:id_rsa|id_ed25519|id_dsa|id_ecdsa)$/i },
  { id: 'ssh_private_key_path', label: 'SSH private key path', regex: /(^|\/)\.ssh\/id_[A-Za-z0-9_-]+$/i },
  { id: 'aws_credentials', label: 'AWS credentials file', regex: /(^|\/)\.aws\/credentials$/i },
  { id: 'kubeconfig', label: 'Kubernetes config', regex: /(^|\/)\.kube\/config$/i },
  { id: 'docker_config', label: 'Docker config credentials', regex: /(^|\/)\.docker\/config\.json$/i },
  { id: 'gcloud_adc', label: 'GCP application default credentials', regex: /application_default_credentials\.json$/i },
  { id: 'pem_key_file', label: 'PEM key file', regex: /\.pem$/i },
];

// Env vars that commonly hold secrets. Used to catch exfil when the secret
// never appears as a literal in the command (e.g. echo $API_KEY | curl ...).
const SECRET_ENV_VAR_PATTERN = /\$\{?(?:API[_-]?KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|AWS_SESSION_TOKEN|GITHUB_TOKEN|GH_TOKEN|STRIPE_SECRET_KEY|STRIPE_API_KEY|NPM_TOKEN|HF_TOKEN|HUGGINGFACE_TOKEN|DATABASE_URL|DB_PASSWORD|POSTGRES_PASSWORD|MYSQL_PWD|PRIVATE_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET|SLACK_BOT_TOKEN|DISCORD_TOKEN)(?!\w)/i;

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
  'base64',
  'xxd',
  'od',
  'hexdump',
];

// Tools that can carry secret material off-box.
const OUTBOUND_FILE_COMMANDS = new Set(['curl', 'wget', 'http', 'https', 'httpie']);
const NETWORK_EXFIL_COMMANDS = new Set([
  'curl', 'wget', 'nc', 'ncat', 'netcat', 'scp', 'rsync', 'sftp', 'ftp', 'lftp',
  'http', 'https', 'httpie', 'rclone', 'aws', 'gsutil', 'az', 'gcloud',
]);
const SECRET_FILE_READ_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'base64', 'xxd', 'od', 'hexdump',
  'gzip', 'bzip2', 'xz', 'dd', 'pv', 'tee', 'type', 'bat',
]);
// Cloud / object-store verbs that upload local files off-box.
const CLOUD_UPLOAD_VERBS = new Set(['cp', 'mv', 'sync', 'copy', 'copyto', 'move', 'upload']);
const OUTBOUND_COMMAND_WRAPPERS = new Set(['command', 'env', 'nohup', 'sudo']);
const SHELL_QUOTES = new Set(['"', "'"]);
const SHELL_SEGMENT_SEPARATORS = new Set([';', '|', '&', '\n']);
const WRAPPER_OPTIONS_WITH_VALUE = {
  env: new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']),
  sudo: new Set([
    '-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt',
    '-C', '--close-from', '-T', '--command-timeout', '-R', '--chroot',
    '-D', '--chdir',
  ]),
};
// Note: --data-raw does NOT treat @ as a file reference (curl man page).
// Keep it out so literal @payload strings are not false-positive scanned.
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
  // Public keys are not secret material (id_ed25519.pub, id_rsa.pub, …).
  if (/\.pub$/i.test(normalized)) return null;
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

function flushToken(tokens, state) {
  if (!state.current) return;
  tokens.push(state.current);
  state.current = '';
}

function consumeTokenCharacter(state, tokens, char) {
  if (state.escaped) {
    state.current += char;
    state.escaped = false;
    return;
  }
  if (char === '\\' && state.quote !== "'") {
    state.escaped = true;
    return;
  }
  if (state.quote) {
    if (char === state.quote) state.quote = null;
    else state.current += char;
    return;
  }
  if (SHELL_QUOTES.has(char)) {
    state.quote = char;
    return;
  }
  if (/\s/.test(char)) {
    flushToken(tokens, state);
    return;
  }
  state.current += char;
}

function tokenizeCommand(command) {
  const tokens = [];
  const state = { current: '', quote: null, escaped: false };

  for (const char of String(command || '')) {
    consumeTokenCharacter(state, tokens, char);
  }
  if (state.escaped) state.current += '\\';
  flushToken(tokens, state);
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

function flushCommandSegment(segments, state) {
  const segment = state.current.trim();
  if (segment) segments.push(segment);
  state.current = '';
}

function consumeSegmentCharacter(state, segments, char) {
  if (state.escaped) {
    state.current += char;
    state.escaped = false;
    return;
  }
  if (char === '\\' && state.quote !== "'") {
    state.current += char;
    state.escaped = true;
    return;
  }
  if (state.quote) {
    state.current += char;
    if (char === state.quote) state.quote = null;
    return;
  }
  if (SHELL_QUOTES.has(char)) {
    state.quote = char;
    state.current += char;
    return;
  }
  if (SHELL_SEGMENT_SEPARATORS.has(char)) {
    flushCommandSegment(segments, state);
    return;
  }
  state.current += char;
}

function splitCommandSegments(command) {
  const segments = [];
  const state = { current: '', quote: null, escaped: false };

  for (const char of String(command || '')) {
    consumeSegmentCharacter(state, segments, char);
  }
  flushCommandSegment(segments, state);
  return segments;
}

function isShellAssignment(token) {
  return /^[A-Za-z_]\w*=/.test(String(token || ''));
}

function skipWrapperOptions(tokens, startIndex, wrapper) {
  let index = startIndex;
  const valueOptions = WRAPPER_OPTIONS_WITH_VALUE[wrapper] || new Set();

  while (index < tokens.length) {
    const token = String(tokens[index] || '');
    if (wrapper === 'env' && isShellAssignment(token)) {
      index += 1;
      continue;
    }
    if (token === '--') return index + 1;
    if (!token.startsWith('-')) return index;
    if (wrapper === 'command' && (token === '-v' || token === '-V')) return -1;

    const optionName = token.split('=', 1)[0];
    if (valueOptions.has(optionName) && !token.includes('=')) index += 2;
    else index += 1;
  }

  return index;
}

function findOutboundCommand(tokens) {
  let index = 0;
  while (isShellAssignment(tokens[index])) index += 1;

  while (index < tokens.length) {
    const wrapper = path.basename(String(tokens[index] || '')).toLowerCase();
    if (!OUTBOUND_COMMAND_WRAPPERS.has(wrapper)) break;
    index += 1;
    index = skipWrapperOptions(tokens, index, wrapper);
    if (index < 0) return null;
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
  const marker = /(?:^|=)[@<](.+)$/.exec(normalized);
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

function findOutboundOptionArgument(args, index, specs) {
  for (const spec of specs) {
    for (const option of spec.options) {
      const argument = readOptionArgument(args, index, option);
      if (argument) return { argument, fileReference: spec.fileReference, option };
    }
  }
  return null;
}

function extractCommandFileReferences(command, args, cwd, references) {
  const specs = outboundOptionSpecs(command);
  for (let index = 0; index < args.length; index += 1) {
    const match = findOutboundOptionArgument(args, index, specs);
    if (!match) continue;
    addOutboundReference(references, match.fileReference(match.argument.value, match.option), cwd, {
      command,
      option: match.option,
    });
    if (match.argument.consumesNext) index += 1;
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

function commandTextFindings(inlineScan) {
  return inlineScan.findings.map((finding) => ({
    ...finding,
    reason: `${finding.label} found in command text`,
  }));
}

function scanCommandReadFiles(command, cwd, provider) {
  const tokens = tokenizeCommand(command);
  const verb = String(tokens[0] || '').toLowerCase();
  if (!BASH_SECRET_READ_PREFIXES.includes(verb)) return [];

  const findings = [];
  for (const token of tokens.slice(1)) {
    if (!looksLikePath(token)) continue;
    const resolved = resolvePathToken(token, cwd);
    const fileScan = scanFile(resolved, { provider });
    if (!fileScan.detected) continue;
    findings.push(...fileScan.findings.map((finding) => ({
      ...finding,
      source: 'command_file',
    })));
  }
  return findings;
}

function scanOutboundCommandFiles(command, cwd, provider) {
  const findings = [];
  const fileHashes = [];
  for (const reference of extractOutboundFileReferences(command, cwd)) {
    // Path findings count: curl --data-binary @.env must deny even when the
    // file is missing or empty. Content findings still apply when present.
    const fileScan = scanFile(reference.path, {
      provider,
      includePathFinding: true,
    });
    if (!fileScan.detected) continue;
    findings.push(...fileScan.findings.map((finding) => ({
      ...finding,
      source: 'outbound_file',
      reason: finding.reason
        || `${finding.label} found in file referenced by ${reference.command} ${reference.option}`,
    })));
    if (fileScan.fileHash) fileHashes.push(fileScan.fileHash);
  }
  return { findings, fileHashes };
}

function classifySecretPathToken(token) {
  const raw = String(token || '').trim().replace(/^["']|["']$/g, '');
  if (!raw || raw === '-') return null;
  // Strip curl @file / form field=@file / <file prefixes.
  let candidate = raw;
  if (candidate.startsWith('@')) candidate = candidate.slice(1);
  const formAt = candidate.indexOf('=@');
  if (formAt > 0) candidate = candidate.slice(formAt + 2);
  const formLt = candidate.indexOf('=<');
  if (formLt > 0) candidate = candidate.slice(formLt + 2);
  candidate = candidate.split(';', 1)[0];
  // Drop remote scp host:path → keep local path side when present.
  if (/^[A-Za-z0-9._-]+@[^:]+:/.test(candidate)) return null;
  return classifySecretPath(candidate) || classifySecretPath(path.basename(candidate));
}

function segmentHasNetworkExfil(segment) {
  const tokens = tokenizeCommand(segment);
  for (const token of tokens) {
    const verb = path.basename(String(token || '')).toLowerCase();
    if (NETWORK_EXFIL_COMMANDS.has(verb)) return verb;
  }
  return null;
}

function segmentSecretPathFindings(segment, cwd) {
  const findings = [];
  const tokens = tokenizeCommand(segment);
  for (const token of tokens) {
    const pathFinding = classifySecretPathToken(token);
    if (!pathFinding) continue;
    const resolved = resolvePathToken(
      String(token).replace(/^@/, '').split('=@').pop().split('=<').pop().split(';', 1)[0],
      cwd
    );
    findings.push({
      ...pathFinding,
      path: resolved || pathFinding.path,
      source: 'exfil_path',
      reason: `${pathFinding.label} referenced in potential exfiltration command`,
    });
  }
  return findings;
}

function detectCommandSubstitutionExfil(command, cwd) {
  // $(cat .env), $(base64 .env), `cat .env`, <(cat .env) — secret not literal in curl argv.
  const findings = [];
  const patterns = [
    /\$\(\s*([a-z0-9._+-]+)\s+([^)]+)\)/gi,
    /`\s*([a-z0-9._+-]+)\s+([^`]+)`/gi,
    /<\(\s*([a-z0-9._+-]+)\s+([^)]+)\)/gi,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(command);
    while (match) {
      const verb = path.basename(String(match[1] || '')).toLowerCase();
      if (!SECRET_FILE_READ_COMMANDS.has(verb)) {
        match = pattern.exec(command);
        continue;
      }
      const args = tokenizeCommand(match[2] || '');
      for (const arg of args) {
        const pathFinding = classifySecretPathToken(arg);
        if (!pathFinding) continue;
        findings.push({
          ...pathFinding,
          source: 'command_substitution',
          reason: `${pathFinding.label} read via command substitution (${verb}) for possible exfiltration`,
        });
      }
      match = pattern.exec(command);
    }
  }
  // Only treat as exfil when a real network/transfer sink is present.
  // Do not treat a URL mentioned in documentation text as a sink.
  if (findings.length === 0) return [];
  const hasNetwork = Boolean(segmentHasNetworkExfil(command))
    || /\/dev\/tcp\//i.test(command);
  if (!hasNetwork) return [];
  return findings;
}

function detectPipelineExfil(command, cwd) {
  // cat .env | nc … ; base64 .env | curl … ; echo $API_KEY | curl …
  const findings = [];
  const segments = String(command || '').split(/(?<![|])\|(?![|])/);
  if (segments.length < 2) return findings;

  for (let i = 0; i < segments.length - 1; i += 1) {
    const left = segments[i];
    const right = segments.slice(i + 1).join('|');
    const networkVerb = segmentHasNetworkExfil(right);
    if (!networkVerb) continue;

    const pathFindings = segmentSecretPathFindings(left, cwd);
    for (const finding of pathFindings) {
      findings.push({
        ...finding,
        source: 'pipeline_exfil',
        reason: `${finding.label} piped into ${networkVerb}`,
      });
    }

    SECRET_ENV_VAR_PATTERN.lastIndex = 0;
    if (SECRET_ENV_VAR_PATTERN.test(left) || SECRET_ENV_VAR_PATTERN.test(right)) {
      findings.push({
        id: 'secret_env_exfil',
        label: 'Secret environment variable',
        source: 'pipeline_exfil',
        reason: `Secret-bearing environment variable piped into ${networkVerb}`,
      });
    }
  }
  return findings;
}

function detectScpRsyncExfil(command, cwd) {
  const findings = [];
  for (const segment of splitCommandSegments(command)) {
    const tokens = tokenizeCommand(segment);
    if (!tokens.length) continue;
    let index = 0;
    while (isShellAssignment(tokens[index])) index += 1;
    const verb = path.basename(String(tokens[index] || '')).toLowerCase();
    if (verb !== 'scp' && verb !== 'rsync' && verb !== 'sftp') continue;
    for (const token of tokens.slice(index + 1)) {
      if (String(token).startsWith('-')) continue;
      // scp local secret → remote  OR  remote → local (still sensitive move)
      const localSide = String(token).includes(':') && !String(token).startsWith('/')
        ? String(token).split(':').slice(1).join(':')
        : token;
      const pathFinding = classifySecretPathToken(localSide) || classifySecretPathToken(token);
      if (!pathFinding) continue;
      findings.push({
        ...pathFinding,
        source: 'transfer_exfil',
        reason: `${pathFinding.label} referenced by ${verb} transfer`,
      });
    }
  }
  return findings;
}

function detectEnvVarNetworkExfil(command) {
  // echo $API_KEY | curl  OR  curl -d "$OPENAI_API_KEY" https://…
  // printenv API_KEY | curl
  // Require a parsed network/transfer verb or /dev/tcp — a URL in docs text alone
  // must not hard-deny (e.g. printf 'Set $OPENAI_API_KEY then visit https://…').
  const text = String(command || '');
  SECRET_ENV_VAR_PATTERN.lastIndex = 0;
  const hasEnvRef = SECRET_ENV_VAR_PATTERN.test(text)
    || /\bprintenv\s+(?:API[_-]?KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|GH_TOKEN|STRIPE_SECRET_KEY|NPM_TOKEN|ACCESS_TOKEN|CLIENT_SECRET)\b/i.test(text)
    || /\benv\s+(?:API[_-]?KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN)\b/i.test(text);
  if (!hasEnvRef) return [];
  const networkVerb = segmentHasNetworkExfil(command);
  if (!networkVerb && !/\/dev\/tcp\//i.test(command)) {
    return [];
  }
  return [{
    id: 'secret_env_exfil',
    label: 'Secret environment variable',
    source: 'env_exfil',
    reason: `Secret-bearing environment variable used with network tool (${networkVerb || '/dev/tcp'})`,
  }];
}

function detectRedirectExfil(command, cwd) {
  // curl … < .env   |   nc host port < ~/.aws/credentials   |   … > /dev/tcp/host/port
  const findings = [];
  const text = String(command || '');
  const hasNetwork = Boolean(segmentHasNetworkExfil(text))
    || /https?:\/\//i.test(text)
    || /\/dev\/tcp\//i.test(text);
  if (!hasNetwork) return findings;

  // stdin redirect from a secret path
  const redirectRe = /(?:^|[\s;|&])\d*\s*<\s*([^\s;|&><]+)/g;
  let match = redirectRe.exec(text);
  while (match) {
    const pathFinding = classifySecretPathToken(match[1]);
    if (pathFinding) {
      findings.push({
        ...pathFinding,
        source: 'redirect_exfil',
        reason: `${pathFinding.label} redirected into a network-bound command`,
      });
    }
    match = redirectRe.exec(text);
  }

  // Bash /dev/tcp with secret path anywhere in the same command
  if (/\/dev\/tcp\//i.test(text)) {
    const tokens = tokenizeCommand(text.replace(/[<>]/g, ' '));
    for (const token of tokens) {
      const pathFinding = classifySecretPathToken(token);
      if (!pathFinding) continue;
      findings.push({
        ...pathFinding,
        source: 'dev_tcp_exfil',
        reason: `${pathFinding.label} used with /dev/tcp network redirect`,
      });
    }
  }

  // dd if=.env | curl / nc
  const ddMatch = /\bdd\b[\s\S]*?\bif=([^\s]+)/i.exec(text);
  if (ddMatch) {
    const pathFinding = classifySecretPathToken(ddMatch[1]);
    if (pathFinding && (Boolean(segmentHasNetworkExfil(text)) || /\|/.test(text) || /\/dev\/tcp\//i.test(text))) {
      findings.push({
        ...pathFinding,
        source: 'dd_exfil',
        reason: `${pathFinding.label} read via dd if= toward network`,
      });
    }
  }

  return findings;
}

function detectCloudCliExfil(command, cwd) {
  // aws s3 cp .env s3://bucket/  |  gsutil cp .env gs://  |  rclone copy .env remote:
  // az storage blob upload --file .env
  const findings = [];
  const text = String(command || '');
  const tokens = tokenizeCommand(text);
  if (!tokens.length) return findings;

  let index = 0;
  while (isShellAssignment(tokens[index])) index += 1;
  const root = path.basename(String(tokens[index] || '')).toLowerCase();

  const isCloud = root === 'aws' || root === 'gsutil' || root === 'gcloud'
    || root === 'az' || root === 'rclone';
  if (!isCloud) return findings;

  // Require an upload-ish subcommand somewhere in the argv.
  const hasUploadVerb = tokens.some((t) => CLOUD_UPLOAD_VERBS.has(String(t).toLowerCase()))
    || /\bblob\s+upload\b/i.test(text)
    || /\bstorage\s+cp\b/i.test(text);
  if (!hasUploadVerb) return findings;

  // Remote destination markers
  const hasRemote = tokens.some((t) => /^(?:s3|gs|gcs|az|azure|oss):\/\//i.test(t) || /^[A-Za-z0-9_-]+:/.test(t) && !t.startsWith('/') && t.includes(':'))
    || /--account-name|--container|--bucket/i.test(text);
  if (!hasRemote && root !== 'rclone') {
    // Still flag if a secret path is an explicit --file argument for az upload
  }

  for (const token of tokens) {
    if (String(token).startsWith('-') && !String(token).includes('=@') && !String(token).includes('/')) {
      // --file=.env or --file .env handled via next token / equals form below
    }
    const stripped = String(token).replace(/^--?[A-Za-z0-9_-]+=/, '');
    const pathFinding = classifySecretPathToken(stripped) || classifySecretPathToken(token);
    if (!pathFinding) continue;
    findings.push({
      ...pathFinding,
      source: 'cloud_cli_exfil',
      reason: `${pathFinding.label} referenced by cloud upload CLI (${root})`,
    });
  }

  // az storage blob upload --file .env
  const fileFlag = /(?:--file|-f)\s+([^\s]+)/i.exec(text);
  if (fileFlag) {
    const pathFinding = classifySecretPathToken(fileFlag[1]);
    if (pathFinding) {
      findings.push({
        ...pathFinding,
        source: 'cloud_cli_exfil',
        reason: `${pathFinding.label} passed to ${root} --file upload`,
      });
    }
  }

  return findings;
}

function detectArchivePipeExfil(command, cwd) {
  // tar czf - .env | curl  |  zip - .env | nc  |  tar -c .ssh | …
  const findings = [];
  const text = String(command || '');
  if (!/\|/.test(text) && !segmentHasNetworkExfil(text) && !/https?:\/\//i.test(text)) {
    return findings;
  }
  const segments = text.split(/(?<![|])\|(?![|])/);
  const left = segments[0] || text;
  const archiveVerb = path.basename(String(tokenizeCommand(left)[0] || '')).toLowerCase();
  if (!['tar', 'zip', 'gzip', 'pigz', '7z', 'rar'].includes(archiveVerb)) {
    // Also: tar … without being first if wrappers — skip for now
    if (!/\b(?:tar|zip)\b/i.test(left)) return findings;
  }
  const right = segments.slice(1).join('|') || text;
  const networkVerb = segmentHasNetworkExfil(right) || segmentHasNetworkExfil(text);
  if (!networkVerb && !/https?:\/\//i.test(text)) return findings;

  for (const token of tokenizeCommand(left)) {
    const pathFinding = classifySecretPathToken(token);
    if (!pathFinding) continue;
    findings.push({
      ...pathFinding,
      source: 'archive_exfil',
      reason: `${pathFinding.label} archived/streamed toward network (${networkVerb || 'url'})`,
    });
  }
  // bare `.ssh` / `.aws` directories in tar
  if (/(?:^|\s)(?:\.ssh|\.aws|\.gnupg|\.kube)(?:\s|$)/.test(left)) {
    findings.push({
      id: 'secret_dir_archive',
      label: 'Secret credential directory',
      source: 'archive_exfil',
      reason: 'Credential directory streamed toward network',
    });
  }
  return findings;
}

function detectInterpreterExfil(command, cwd) {
  // python -c '…open(".env")…requests…'  |  node -e '…readFileSync(".env")…fetch…'
  const text = String(command || '');
  const isInterpreter = /\b(?:python3?|node|nodejs|php|ruby|perl)\b/i.test(text)
    && /(?:-c|-e|--eval)\b/i.test(text);
  if (!isInterpreter) return [];

  const touchesSecretPath = /\.env(?:\.[A-Za-z0-9_-]+)?|\.aws\/credentials|\.ssh\/id_|\.netrc|\.npmrc|application_default_credentials/i.test(text);
  const touchesSecretEnv = /(?:API_KEY|OPENAI_API_KEY|AWS_SECRET|GITHUB_TOKEN|STRIPE_SECRET|os\.environ|process\.env)/i.test(text);
  const touchesNetwork = /https?:\/\/|requests\.|urllib|fetch\(|http\.request|httpx\.|aiohttp|socket\.|urlopen/i.test(text);
  if (!(touchesSecretPath || touchesSecretEnv) || !touchesNetwork) return [];

  return [{
    id: 'interpreter_exfil',
    label: 'Interpreter secret exfiltration',
    source: 'interpreter_exfil',
    reason: 'Inline interpreter code appears to read secret material and perform network I/O',
  }];
}

function detectStructuralExfiltration(command, cwd) {
  return uniqueFindings([
    ...detectCommandSubstitutionExfil(command, cwd),
    ...detectPipelineExfil(command, cwd),
    ...detectScpRsyncExfil(command, cwd),
    ...detectEnvVarNetworkExfil(command),
    ...detectRedirectExfil(command, cwd),
    ...detectCloudCliExfil(command, cwd),
    ...detectArchivePipeExfil(command, cwd),
    ...detectInterpreterExfil(command, cwd),
  ]);
}

function scanBashCommand(command, options = {}) {
  const cwd = options.cwd || process.cwd();
  const inlineScan = scanText(command, { provider: options.provider, source: 'command' });
  const findings = commandTextFindings(inlineScan);
  findings.push(...scanCommandReadFiles(command, cwd, options.provider));

  const outboundScan = inlineScan.provider === 'off'
    ? { findings: [], fileHashes: [] }
    : scanOutboundCommandFiles(command, cwd, options.provider);
  findings.push(...outboundScan.findings);

  // Structural vectors: secret never appears as a literal in the command text
  // (pipe, command substitution, scp, env-var → network).
  if (inlineScan.provider !== 'off') {
    findings.push(...detectStructuralExfiltration(command, cwd));
  }

  const uniqueFileHashes = [...new Set(outboundScan.fileHashes)];

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

function getToolInputContent(toolInput) {
  return [
    toolInput.content,
    toolInput.new_string,
    toolInput.value,
    toolInput.text,
  ].filter((value) => typeof value === 'string' && value.trim());
}

function scanHookPaths(state, toolName, toolInput, cwd) {
  if (EDIT_LIKE_TOOLS.has(toolName)) return;
  for (const filePath of getToolInputPaths(toolInput, cwd)) {
    const result = scanFile(filePath, { provider: state.provider });
    if (!result.detected) continue;
    state.provider = result.provider;
    state.fileHashes.push(result.fileHash);
    state.findings.push(...result.findings);
  }
}

function scanHookCommand(state, toolInput, cwd) {
  const command = toolInput.command;
  if (typeof command !== 'string' || !command.trim()) return;
  const result = scanBashCommand(command, { provider: state.provider, cwd });
  if (!result.detected) return;
  state.provider = result.provider;
  state.commandHash = result.commandHash;
  state.fileHashes.push(...(result.fileHashes || []));
  state.findings.push(...result.findings);
}

function scanHookContent(state, toolInput, safeSecretStorageWrite) {
  if (safeSecretStorageWrite) return;
  for (const content of getToolInputContent(toolInput)) {
    const result = scanText(content, { provider: state.provider, source: 'tool_input' });
    if (!result.detected) continue;
    state.provider = result.provider;
    state.findings.push(...result.findings);
  }
}

function scanHookInput(input = {}, options = {}) {
  const toolName = String(input.tool_name || input.toolName || '').trim();
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const cwd = input.cwd || options.cwd || process.cwd();
  const state = {
    provider: resolveProvider(options.provider),
    findings: [],
    commandHash: null,
    fileHashes: [],
  };
  const safeSecretStorageWrite = isSafeSecretStorageWrite(toolName, toolInput, cwd);

  scanHookPaths(state, toolName, toolInput, cwd);
  scanHookCommand(state, toolInput, cwd);
  scanHookContent(state, toolInput, safeSecretStorageWrite);

  return {
    detected: state.findings.length > 0,
    provider: state.provider,
    toolName,
    findings: uniqueFindings(state.findings),
    commandHash: state.commandHash,
    fileHashes: state.fileHashes.filter(Boolean),
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
