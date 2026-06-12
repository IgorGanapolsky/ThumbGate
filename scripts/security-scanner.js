#!/usr/bin/env node
'use strict';

const { loadOptionalModule } = require("./private-core-boundary");


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
const { scanInstallCommand, detectSlopsquat } = loadOptionalModule('./slopsquat-guard', () => ({
  scanInstallCommand: () => ({ detected: false, findings: [] }),
  detectSlopsquat: () => null,
}));

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
    remediation: 'Avoid passing unsanitized input to child_process.exec/execSync. Use execFile or spawn with args passed as an array.',
  },
  {
    id: 'shell-interpolation',
    category: 'injection',
    severity: 'critical',
    label: 'Shell command with string interpolation',
    regex: /\bexec(?:Sync)?\s*\(\s*`[^`]*\$\{[^}]*(?:req\.|input|args|params|query|body|user|process\.env)/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs'],
    remediation: 'Use child_process.execFile or child_process.spawn with an array of arguments to avoid shell command interpolation.',
  },
  {
    id: 'sql-injection',
    category: 'injection',
    severity: 'critical',
    label: 'Potential SQL injection via string concatenation',
    regex: /(?:query|execute|run|all|get)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+\s*(?:req\.|input|args|params|query|body|user))/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs', '.py'],
    remediation: 'Use parameterized queries or prepared statements instead of dynamic SQL string concatenation.',
  },
  {
    id: 'eval-usage',
    category: 'injection',
    severity: 'high',
    label: 'Dynamic code execution (eval/Function constructor)',
    regex: /\b(?:eval|new\s+Function)\s*\([^)]*(?:req\.|input|args|params|query|body|user)/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs'],
    remediation: 'Use JSON.parse() or a safe parser library instead of eval() or dynamic Function constructors.',
  },

  // XSS
  {
    id: 'xss-innerhtml',
    category: 'xss',
    severity: 'high',
    label: 'Potential XSS via innerHTML assignment',
    regex: /\.innerHTML\s*=\s*(?!['"]<(?:div|span|p|br|hr)\s*\/?>['"])/g,
    fileTypes: ['.js', '.ts', '.jsx', '.tsx', '.mjs'],
    remediation: 'Use element.textContent or element.innerText instead of innerHTML to prevent cross-site scripting (XSS).',
  },
  {
    id: 'xss-dangerously-set',
    category: 'xss',
    severity: 'high',
    label: 'React dangerouslySetInnerHTML with dynamic content',
    regex: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?!['"])/g,
    fileTypes: ['.jsx', '.tsx', '.js', '.ts'],
    remediation: 'Ensure dynamic content passed to dangerouslySetInnerHTML is sanitized using DOMPurify or equivalent.',
  },

  // Path traversal
  {
    id: 'path-traversal',
    category: 'path-traversal',
    severity: 'critical',
    label: 'Path traversal via unsanitized user input',
    regex: /path\.(?:join|resolve)\s*\([^)]*(?:req\.|input|args|params|query|body|user)/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs'],
    remediation: 'Sanitize path input using path.basename() or validate the path against an explicit list of allowed directories.',
  },
  {
    id: 'path-traversal-direct',
    category: 'path-traversal',
    severity: 'high',
    label: 'Direct file read with user-controlled path',
    regex: /fs\.(?:readFile(?:Sync)?|createReadStream)\s*\(\s*(?:req\.|input|args|params|query|body|user)/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs'],
    remediation: 'Validate input paths and restrict file system access to a sandboxed directory.',
  },

  // Prototype pollution
  {
    id: 'prototype-pollution',
    category: 'prototype-pollution',
    severity: 'high',
    label: 'Potential prototype pollution via recursive merge',
    regex: /(?:__proto__|constructor\s*\[\s*['"]prototype['"]\s*\]|Object\.assign\s*\(\s*\{\s*\})/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs'],
    remediation: 'Avoid recursive object mergers without checking for __proto__ or constructor keys, or use Object.create(null).',
  },

  // Insecure crypto
  {
    id: 'weak-hash',
    category: 'crypto',
    severity: 'medium',
    label: 'Weak hash algorithm (MD5/SHA1) for security use',
    regex: /createHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)/gi,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs'],
    remediation: 'Use SHA-256 or SHA-512 (e.g. crypto.createHash("sha256")) instead of MD5 or SHA-1 for security use cases.',
  },
  {
    id: 'hardcoded-secret',
    category: 'crypto',
    severity: 'high',
    label: 'Hardcoded secret/password in source code',
    regex: /(?:password|secret|apiKey|api_key|token)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{12,}['"]/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs', '.py', '.go', '.java'],
    remediation: 'Move hardcoded secrets to environment variables or use a secure secrets manager.',
  },

  // SSRF
  {
    id: 'ssrf-dynamic-url',
    category: 'ssrf',
    severity: 'high',
    label: 'Potential SSRF via user-controlled URL',
    regex: /(?:fetch|axios|got|request|https?\.(?:get|request))\s*\(\s*(?:`[^`]*\$\{|(?:req\.|input|args|params|query|body|user))/g,
    fileTypes: ['.js', '.ts', '.mjs', '.cjs'],
    remediation: 'Validate the destination host against a strict whitelist of allowed domains and block requests to internal IPs.',
  },

  // Insecure deserialization
  {
    id: 'unsafe-deserialize',
    category: 'deserialization',
    severity: 'critical',
    label: 'Unsafe deserialization of untrusted data',
    regex: /(?:unserialize|yaml\.load\s*\((?!.*Loader\s*=\s*yaml\.SafeLoader)|pickle\.loads?|Marshal\.load)/g,
    fileTypes: ['.js', '.ts', '.py', '.rb'],
    remediation: 'Use safe parsing libraries or options (such as yaml.safeLoad) instead of unsafe deserialization/eval-like loaders.',
  },
  {
    id: 'badhost-url-confusion',
    category: 'host-header',
    severity: 'high',
    label: 'Potential BadHost-style host or URL confusion in AI service',
    regex: /\b(?:request\.url(?:\.path)?|url_for\s*\([^)]*_external\s*=\s*True|headers\s*\[\s*['"](?:host|x-forwarded-host)['"]\s*\])/gi,
    fileTypes: ['.py'],
    remediation: 'Verify Host and X-Forwarded-Host headers against an approved whitelist before using them for routing or URL generation.',
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
    remediation: 'Verify spelling and authenticity of package name. If typosquatted, run: npm uninstall <package>.',
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
    remediation: 'Remove the pre/postinstall script, or run package installation with --ignore-scripts.',
    regex: /["'](?:pre|post)?install["']\s*:\s*["'](?:.*(?:curl|wget|nc\s|bash\s|sh\s|eval|exec|child_process))/g,
  },
  {
    id: 'dep-version-wildcard',
    category: 'supply-chain',
    severity: 'medium',
    label: 'Wildcard or latest version in dependency',
    remediation: 'Specify a concrete version constraint (e.g., "^1.0.0") instead of a wildcard or latest.',
    regex: /["'](?:dependencies|devDependencies|peerDependencies)["'][\s\S]{0,500}?["'][^"']+["']\s*:\s*["'](?:\*|latest|>=)/g,
  },
];

/**
 * Simple static analysis check (reachability/usage check) to see if a package is imported.
 * @param {string} pkg - The package name to search for
 * @param {string} rootDir - Root directory to walk
 * @returns {boolean}
 */
function isPackageImported(pkg, rootDir = process.cwd()) {
  const IGNORED_DIRS = new Set([
    'node_modules', '.git', 'dist', 'coverage', '.planning', '.artifacts', '.gemini', '.antigravitycli'
  ]);
  const FILE_EXTS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py']);
  
  // Escape package name for regex
  const escapedPkg = pkg.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const importRegex = new RegExp(
    `(?:require\\s*\\(\\s*['"]${escapedPkg}['"]\\s*\\)|from\\s*['"]${escapedPkg}['"]|import\\s*\\(\\s*['"]${escapedPkg}['"]\\s*\\)|import\\s+['"]${escapedPkg}['"])`,
    'i'
  );

  let found = false;
  let fileCount = 0;
  const maxFiles = 200; // safety limit to keep it fast (<50ms)

  function walk(dir) {
    if (found || fileCount >= maxFiles) return;
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      return;
    }

    for (const file of files) {
      if (found || fileCount >= maxFiles) return;
      const fullPath = path.join(dir, file);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (!IGNORED_DIRS.has(file)) {
          walk(fullPath);
        }
      } else if (stat.isFile()) {
        const ext = path.extname(file).toLowerCase();
        if (FILE_EXTS.has(ext)) {
          fileCount++;
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (importRegex.test(content)) {
              found = true;
              return;
            }
          } catch {
            // ignore read errors
          }
        }
      }
    }
  }

  walk(rootDir);
  return found;
}

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
        remediation: pattern.remediation,
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
 * Scan Python / AI-service code for BadHost-style URL and host-header confusion.
 * This is deliberately narrow and evidence-oriented: it does not claim a CVE,
 * it flags code that should prove canonical host handling before deployment.
 * @param {string} content
 * @param {string} filePath
 * @returns {{ detected: boolean, findings: Array<Object> }}
 */
function scanBadHostExposure(content, filePath = '') {
  const result = scanCode(content, filePath);
  return {
    detected: result.findings.some((finding) => finding.id === 'badhost-url-confusion'),
    findings: result.findings.filter((finding) => finding.id === 'badhost-url-confusion'),
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
        // Run usage check (reachability)
        const reachable = isPackageImported(pkg);
        const reachability = reachable ? 'imported' : 'unimported';

        // New dependency added — check for red flags
        if (version === '*' || version === 'latest' || version.startsWith('>=')) {
          findings.push({
            id: 'dep-version-wildcard',
            category: 'supply-chain',
            severity: 'medium',
            label: `Wildcard version for new dependency: ${pkg}@${version}`,
            path: 'package.json',
            remediation: `Specify a concrete version constraint (e.g., "^${version === '*' || version === 'latest' ? '1.0.0' : version}") instead of a wildcard.`,
            reachable,
            reachability,
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
            remediation: 'Double-check spelling and verify this package is not a typosquatting attempt.',
            reachable,
            reachability,
          });
        }

        // Tier 3: Slopsquat Guard — deterministic typosquat detection
        const slopsquatFinding = detectSlopsquat(pkg, 'npm');
        if (slopsquatFinding) {
          findings.push({
            id: slopsquatFinding.id,
            category: 'supply-chain',
            severity: slopsquatFinding.severity,
            label: slopsquatFinding.label,
            path: 'package.json',
            remediation: `Verify spelling and authenticity of package "${pkg}". If typosquatted, run: npm uninstall ${pkg}.`,
            reachable,
            reachability,
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
        remediation: 'Remove the suspicious pre/postinstall script, or run package installation with --ignore-scripts.',
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

/**
 * Evaluate slopsquat guard for a Bash command.
 * @param {string} toolName 
 * @param {Object} toolInput 
 * @returns {Object|null}
 */
function evaluateSlopsquatScan(toolName, toolInput) {
  if (toolName !== "Bash") return null;
  const command = toolInput.command || "";
  if (!command) return null;

  const { resolveMode, scanInstallCommand } = loadOptionalModule("./slopsquat-guard", () => ({
    resolveMode: () => "block",
    scanInstallCommand: () => ({ detected: false, findings: [] }),
  }));

  const mode = resolveMode();
  if (mode === "off") return null;

  const result = scanInstallCommand(command);
  if (!result.detected) return null;

  const hasCritical = result.findings.some(f => f.severity === "critical");
  const decision = (mode === "block" && hasCritical) ? "deny" : "warn";

  return {
    decision,
    gate: "slopsquat-guard",
    message: "✗ THUMBGATE: " + result.findings[0].label,
    severity: hasCritical ? "critical" : "high",
    reasoning: result.findings.map(f => f.label),
  };
}

function evaluateSecurityScan(input = {}) {
  const toolName = input.tool_name || input.toolName || '';
  const toolInput = input.tool_input || {};

  // Only scan write-type operations and Bash commands
  const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
  const IS_BASH = toolName === 'Bash';
  
  if (!WRITE_TOOLS.has(toolName) && !IS_BASH) {
    return null;
  }

  const filePath = toolInput.file_path || toolInput.path || '';
  const content = toolInput.content || toolInput.new_string || '';
  const command = toolInput.command || '';

  if (!content && !command) return null;

  // Tier 1: Code vulnerability scan (for Edits)
  let codeResult = { detected: false, findings: [] };
  if (content) {
    codeResult = scanCode(content, filePath);
  }

  // Tier 2: Supply chain scan for package.json changes
  let supplyChainResult = { detected: false, findings: [] };
  if (filePath && path.basename(filePath) === 'package.json' && content) {
    let oldContent = '';
    try {
      const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
      if (fs.existsSync(absPath)) {
        oldContent = fs.readFileSync(absPath, 'utf8');
      }
    } catch { /* new file */ }
    supplyChainResult = scanDependencyChange(oldContent, content);
  }

  // Tier 3: Slopsquat Guard for Bash commands
  let slopsquatResult = { detected: false, findings: [] };
  if (IS_BASH && command) {
    const slopsquatGate = evaluateSlopsquatScan(toolName, toolInput);
    if (slopsquatGate) return slopsquatGate;
  }

  const allFindings = [...codeResult.findings, ...supplyChainResult.findings, ...slopsquatResult.findings];
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

  const message = `Security scan detected ${allFindings.length} issue(s) in ${filePath || (IS_BASH ? 'command' : 'code')}: ${summary}`;

  const reasoning = [
    IS_BASH 
      ? `Scanned Bash command for slopsquat/typosquat risk: "${command.slice(0, 100)}..."`
      : `Scanned ${content.length} bytes of content being written to ${filePath || 'unknown file'}`,
    ...allFindings.map(f => `${f.category}/${f.id}: ${f.label}${f.match ? ` — matched: ${f.match.slice(0, 60)}` : ''}`),
  ];

  recordAuditEvent({
    toolName,
    toolInput: { file_path: filePath, content_length: content.length, command: IS_BASH ? command : undefined },
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

function buildThreatDefensePlaybook(scanResult = {}, options = {}) {
  const findings = Array.isArray(scanResult.findings)
    ? scanResult.findings
    : (scanResult.securityScan && Array.isArray(scanResult.securityScan.findings) ? scanResult.securityScan.findings : []);
  const critical = findings.filter((finding) => finding.severity === 'critical');
  const high = findings.filter((finding) => finding.severity === 'high');
  const categories = Array.from(new Set(findings.map((finding) => finding.category).filter(Boolean)));
  const hasFindings = findings.length > 0;
  const hasPatchEvidence = Boolean(options.patchEvidence || options.testEvidence || options.ciEvidence);

  return {
    name: 'thumbgate-ai-threat-defense-playbook',
    status: critical.length > 0 ? 'block' : high.length > 0 ? 'remediate' : 'monitor',
    phases: [
      {
        id: 'prepare',
        action: 'harden-foundation',
        evidence: ['gate templates enabled', 'protected files configured', 'rollback path documented'],
        required: true,
      },
      {
        id: 'scan-prioritize',
        action: hasFindings ? 'prioritize detected security findings by severity and exploit surface' : 'keep posture scan active',
        evidence: categories.length ? categories : ['clean scan'],
        required: true,
      },
      {
        id: 'remediate',
        action: hasFindings ? 'patch, run focused tests, and re-scan before allowing risky agent actions' : 'no remediation required from current scan',
        evidence: hasPatchEvidence ? ['patch evidence present'] : ['patch diff', 'focused test output', 'repeat scan'],
        required: hasFindings,
      },
      {
        id: 'monitor',
        action: 'record audit event and keep continuous detection enabled for future tool calls',
        evidence: ['audit trail event', 'gate stats', 'review checkpoint'],
        required: true,
      },
    ],
    priority: {
      critical: critical.length,
      high: high.length,
      total: findings.length,
      categories,
    },
    gateDecision: critical.length > 0 ? 'deny' : high.length > 0 ? 'warn' : 'allow',
    nextActions: critical.length > 0
      ? ['Block the action', 'Patch the critical finding', 'Run focused tests', 'Re-scan the diff before retry']
      : high.length > 0
        ? ['Warn the operator', 'Create a remediation task', 'Run focused tests', 'Monitor for repeat findings']
        : ['Keep continuous scan enabled', 'Review checkpoint metrics after the next session'],
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  evaluateSlopsquatScan,
  VULN_PATTERNS,
  SUPPLY_CHAIN_PATTERNS,
  scanCode,
  scanBadHostExposure,
  scanDependencyChange,
  evaluateSecurityScan,
  scanGitDiff,
  buildThreatDefensePlaybook,
};
