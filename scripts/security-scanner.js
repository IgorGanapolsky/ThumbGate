#!/usr/bin/env node
'use strict';

/**
 * Security Scanner — OWASP-aware static analysis for PreToolUse checks.
 *
 * Scans code being written/edited by AI agents for common vulnerability
 * patterns (injection, XSS, path traversal, etc.) and suspicious dependency
 * changes. Designed to run in the hot path of PreToolUse hooks with <50ms
 * latency for pattern-match tier; deeper analysis is opt-in.
 *
 * Tier 1 (always): regex pattern matching — fast, zero external deps
 * Tier 2 (high-risk): AST-level checks for dependency mutations
 */

const fs = require('fs');
const path = require('path');
const { recordAuditEvent, auditToFeedback } = require('./audit-trail');

// ---------------------------------------------------------------------------
// Vulnerability pattern definitions (OWASP Top 10 + supply chain)
// ---------------------------------------------------------------------------

const VULN_PATTERNS = [
  // Injection
  {
    id: 'cmd-injection',
    category: 'injection',
    severity: 'critical',
    label: 'Command injection via unsanitized input',
    regex: /\bexec(?:Sync)?\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+\s*(?:req\.|input|args|params|query|body|user))/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs'],
  },
  {
    id: 'shell-interpolation',
    category: 'injection',
    severity: 'critical',
    label: 'Shell command with string interpolation',
    regex: /\bexec(?:Sync)?\s*\(\s*`[^`]*\$\{[^}]*(?:req\.|input|args|params|query|body|user|process\.env)/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs'],
  },
  {
    id: 'sql-injection',
    category: 'injection',
    severity: 'critical',
    label: 'Potential SQL injection via string concatenation',
    regex: /(?:query|execute|run|all|get)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+\s*(?:req\.|input|args|params|query|body|user))/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs', '.py'],
  },
  {
    id: 'eval-usage',
    category: 'injection',
    severity: 'high',
    label: 'Dynamic code execution (eval/Function constructor)',
    regex: /\b(?:eval|new\s+Function)\s*\([^)]*(?:req\.|input|args|params|query|body|user)/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs'],
  },

  // XSS
  {
    id: 'xss-innerhtml',
    category: 'xss',
    severity: 'high',
    label: 'Potential XSS via innerHTML assignment',
    regex: /\.innerHTML\s*=\s*(?!['"]<(?:div|span|p|br|hr)\s*\/?>['"])/g,
    fileTypes: ['.js', '.ts', '.jsx', '.tsx', '.mjs'],
  },
  {
    id: 'xss-dangerously-set',
    category: 'xss',
    severity: 'high',
    label: 'React dangerouslySetInnerHTML with dynamic content',
    regex: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?!['"])/g,
    fileTypes: ['.jsx', '.tsx', '.js', '.ts'],
  },

  // Path traversal
  {
    id: 'path-traversal',
    category: 'path-traversal',
    severity: 'critical',
    label: 'Path traversal via unsanitized user input',
    regex: /path\.(?:join|resolve)\s*\([^)]*(?:req\.|input|args|params|query|body|user)/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs'],
  },
  {
    id: 'path-traversal-direct',
    category: 'path-traversal',
    severity: 'high',
    label: 'Direct file read with user-controlled path',
    regex: /fs\.(?:readFile(?:Sync)?|createReadStream)\s*\(\s*(?:req\.|input|args|params|query|body|user)/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs'],
  },

  // Prototype pollution
  {
    id: 'prototype-pollution',
    category: 'prototype-pollution',
    severity: 'high',
    label: 'Potential prototype pollution via recursive merge',
    regex: /(?:__proto__|constructor\s*\[\s*['"]prototype['"]\s*\]|Object\.assign\s*\(\s*\{\s*\})/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs'],
  },

  // Insecure crypto
  {
    id: 'weak-hash',
    category: 'crypto',
    severity: 'medium',
    label: 'Weak hash algorithm (MD5/SHA1) for security use',
    regex: /createHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)/gi,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs'],
  },
  {
    id: 'hardcoded-secret',
    category: 'crypto',
    severity: 'high',
    label: 'Hardcoded secret/password in source code',
    regex: /(?:password|secret|apiKey|api_key|token)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{12,}['"]/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs', '.py', '.go', '.java'],
  },

  // SSRF
  {
    id: 'ssrf-dynamic-url',
    category: 'ssrf',
    severity: 'high',
    label: 'Potential SSRF via user-controlled URL',
    regex: /(?:fetch|axios|got|request|https?\.(?:get|request))\s*\(\s*(?:`[^`]*\$\{|(?:req\.|input|args|params|query|body|user))/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs'],
  },

  // Insecure deserialization
  {
    id: 'unsafe-deserialize',
    category: 'deserialization',
    severity: 'critical',
    label: 'Unsafe deserialization of untrusted data',
    regex: /(?:unserialize|yaml\.load\s*\((?!.*Loader\s*=\s*yaml\.SafeLoader)|pickle\.loads?|Marshal\.load)/g,
    fileTypes: ['.js', '.ts', '.py', '.rb'],
  },
];

// ---------------------------------------------------------------------------
// Supply chain patterns (dependency mutations)
// ---------------------------------------------------------------------------

const SUPPLY_CHAIN_PATTERNS = [
  {
    id: 'typosquat-suspect',
    category: 'supply-chain',
    severity: 'high',
    label: 'Potentially typosquatted package name',
    // Common typosquat indicators: single-char substitutions of popular packages
    knownSafe: new Set([
      'express', 'lodash', 'axios', 'react', 'vue', 'angular', 'moment',
      'chalk', 'commander', 'inquirer', 'jest', 'mocha', 'webpack',
      'typescript', 'eslint', 'prettier', 'nodemon', 'dotenv', 'cors',
      'uuid', 'debug', 'semver', 'glob', 'minimatch', 'yargs',
    ]),
  },
  {
    id: 'install-script-abuse',
    category: 'supply-chain',
    severity: 'critical',
    label: 'Suspicious install script in package.json',
    regex: /["'](?:pre|post)?install["']\s*:\s*["'](?:.*(?:curl|wget|nc\s|bash\s|sh\s|eval|exec|child_process))/g,
  },
  {
    id: 'dep-version-wildcard',
    category: 'supply-chain',
    severity: 'medium',
    label: 'Wildcard or latest version in dependency',
    regex: /["'](?:dependencies|devDependencies|peerDependencies)["'][\s\S]{0,500}?["'][^"']+["']\s*:\s*["'](?:\*|latest|>=)/g,
  },
];

// ---------------------------------------------------------------------------
// Core scanning functions
// ---------------------------------------------------------------------------

/**
 * Scan code content for vulnerability patterns.
 * @param {string} content - The code content to scan
 * @param {string} filePath - The file path (for file-type filtering)
 * @returns {{ detected: boolean, findings: Array<Object> }}
 */
function scanCode(content, filePath = '') {
  if (!content || typeof content !== 'string') {
    return { detected: false, findings: [] };
  }

  const ext = path.extname(filePath).toLowerCase();
  const findings = [];

  for (const pattern of VULN_PATTERNS) {
    // Skip patterns that don't apply to this file type
    if (pattern.fileTypes && pattern.fileTypes.length > 0 && ext && !pattern.fileTypes.includes(ext)) {
      continue;
    }

    // Reset regex lastIndex for global patterns
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      findings.push({
        id: pattern.id,
        category: pattern.category,
        severity: pattern.severity,
        label: pattern.label,
        line: lineNumber,
        match: match[0].slice(0, 120),
        path: filePath,
      });
      // Only report first match per pattern per file to avoid noise
      break;
    }
  }

  return {
    detected: findings.length > 0,
    findings,
  };
}

/**
 * Scan dependency changes in package.json mutations.
 * @param {string} oldContent - Previous package.json content (empty string if new file)
 * @param {string} newContent - New package.json content
 * @returns {{ detected: boolean, findings: Array<Object> }}
 */
function scanDependencyChange(oldContent, newContent) {
  const findings = [];

  if (!newContent) return { detected: false, findings: [] };

  let newPkg;
  try {
    newPkg = JSON.parse(newContent);
  } catch {
    return { detected: false, findings: [] };
  }

  let oldPkg = {};
  if (oldContent) {
    try { oldPkg = JSON.parse(oldContent); } catch { /* treat as empty */ }
  }

  const depSections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

  // Check for new dependencies added
  for (const section of depSections) {
    const oldDeps = (oldPkg[section] || {});
    const newDeps = (newPkg[section] || {});

    for (const [pkg, version] of Object.entries(newDeps)) {
      if (!oldDeps[pkg]) {
        // New dependency added — check for red flags
        if (version === '*' || version === 'latest' || version.startsWith('>=')) {
          findings.push({
            id: 'dep-version-wildcard',
            category: 'supply-chain',
            severity: 'medium',
            label: `Wildcard version for new dependency: ${pkg}@${version}`,
            path: 'package.json',
          });
        }

        // Check for packages with suspicious names (very short, similar to popular ones)
        if (pkg.length <= 2 && !['fs', 'os', 'vm'].includes(pkg)) {
          findings.push({
            id: 'suspicious-pkg-name',
            category: 'supply-chain',
            severity: 'high',
            label: `Suspiciously short package name: "${pkg}"`,
            path: 'package.json',
          });
        }
      }
    }
  }

  // Check for suspicious install scripts
  const scripts = newPkg.scripts || {};
  const dangerousScriptPatterns = /curl|wget|nc\s|bash\s-c|sh\s-c|eval\s|child_process|\.exec\(/i;
  for (const [name, cmd] of Object.entries(scripts)) {
    if (/^(?:pre|post)?install$/.test(name) && dangerousScriptPatterns.test(cmd)) {
      findings.push({
        id: 'install-script-abuse',
        category: 'supply-chain',
        severity: 'critical',
        label: `Suspicious install script: ${name} → ${cmd.slice(0, 80)}`,
        path: 'package.json',
      });
    }
  }

  return {
    detected: findings.length > 0,
    findings,
  };
}

// ---------------------------------------------------------------------------
// PreToolUse integration — called from gates-engine
// ---------------------------------------------------------------------------

/**
 * Evaluate security scan for a PreToolUse hook input.
 * Returns a gate result if vulnerabilities are found, null otherwise.
 *
 * @param {Object} input - Hook input { tool_name, tool_input }
 * @returns {Object|null} Gate result or null if clean
 */
function evaluateSecurityScan(input = {}) {
  const toolName = input.tool_name || input.toolName || '';
  const toolInput = input.tool_input || {};

  // Only scan write-type operations
  const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
  if (!WRITE_TOOLS.has(toolName)) {
    return null;
  }

  const filePath = toolInput.file_path || toolInput.path || '';
  const content = toolInput.content || toolInput.new_string || '';

  if (!content) return null;

  // Tier 1: Code vulnerability scan
  const codeResult = scanCode(content, filePath);

  // Tier 2: Supply chain scan for package.json changes
  let supplyChainResult = { detected: false, findings: [] };
  if (filePath && path.basename(filePath) === 'package.json') {
    let oldContent = '';
    try {
      const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
      if (fs.existsSync(absPath)) {
        oldContent = fs.readFileSync(absPath, 'utf8');
      }
    } catch { /* new file */ }
    supplyChainResult = scanDependencyChange(oldContent, content);
  }

  const allFindings = [...codeResult.findings, ...supplyChainResult.findings];
  if (allFindings.length === 0) return null;

  // Determine overall severity
  const hasCritical = allFindings.some(f => f.severity === 'critical');
  const hasHigh = allFindings.some(f => f.severity === 'high');
  const overallSeverity = hasCritical ? 'critical' : hasHigh ? 'high' : 'medium';

  // Critical findings block; high/medium warn
  const decision = hasCritical ? 'deny' : 'warn';
  const gateId = 'security-vuln-scan';
  const summary = allFindings.map(f =>
    `[${f.severity.toUpperCase()}] ${f.label}${f.line ? ` (line ${f.line})` : ''}`
  ).join('; ');

  const message = `Security scan detected ${allFindings.length} issue(s) in ${filePath || 'code'}: ${summary}`;

  const reasoning = [
    `Scanned ${content.length} bytes of content being written to ${filePath || 'unknown file'}`,
    ...allFindings.map(f => `${f.category}/${f.id}: ${f.label}${f.match ? ` — matched: ${f.match.slice(0, 60)}` : ''}`),
  ];

  recordAuditEvent({
    toolName,
    toolInput: { file_path: filePath, content_length: content.length },
    decision,
    gateId,
    message,
    severity: overallSeverity,
    source: 'security-scanner',
  });

  return {
    decision,
    gate: gateId,
    message,
    severity: overallSeverity,
    reasoning,
    securityScan: {
      findings: allFindings,
      scannedBytes: content.length,
      filePath,
    },
  };
}

// ---------------------------------------------------------------------------
// Self-heal integration — scan recent commits for vulnerabilities
// ---------------------------------------------------------------------------

/**
 * Scan git diff content for vulnerabilities introduced in recent changes.
 * Intended for self-heal pipeline and post-commit auditing.
 *
 * @param {string} diffContent - Output of `git diff` or `git show`
 * @returns {{ clean: boolean, findings: Array<Object> }}
 */
function scanGitDiff(diffContent) {
  if (!diffContent) return { clean: true, findings: [] };

  const allFindings = [];
  let currentFile = '';

  for (const line of diffContent.split('\n')) {
    // Track current file from diff headers
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }

    // Only scan added lines
    if (!line.startsWith('+') || line.startsWith('+++')) continue;

    const addedContent = line.slice(1);
    const result = scanCode(addedContent, currentFile);
    if (result.detected) {
      for (const finding of result.findings) {
        finding.path = currentFile;
        allFindings.push(finding);
      }
    }
  }

  return {
    clean: allFindings.length === 0,
    findings: allFindings,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  VULN_PATTERNS,
  SUPPLY_CHAIN_PATTERNS,
  scanCode,
  scanDependencyChange,
  evaluateSecurityScan,
  scanGitDiff,
};
