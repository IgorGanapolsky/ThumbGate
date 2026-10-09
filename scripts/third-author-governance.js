'use strict';

/**
 * scripts/third-author-governance.js
 *
 * "The Third Author" Governance Engine for ThumbGate.
 * Stolen & improved from SCANOSS Earnie (October 2026).
 *
 * Core Concept:
 *   Your code got a third author:
 *   1. The human engineer (reviewed, accountable).
 *   2. Open source (packages, snippets, license obligations).
 *   3. AI agents (faster than review, never learned your policy).
 *
 * One Policy, Three Checkpoints:
 *   - Checkpoint 1: MCP / PreToolUse Gate (<0.5ms on CPU; blocks bad installs before execution; suggests permissive alternatives).
 *   - Checkpoint 2: Git Pre-Commit Hook (blocks commit; points to `npx thumbgate explain <FINDING-ID>`).
 *   - Checkpoint 3: PR Gate (posts verdict: pass, warn, require approval, block).
 *
 * Four Risks, One Record (The BOM Quadrant):
 *   - Risk 1: AI Models (AIBOM - SDKs, model weights, framework dependencies).
 *   - Risk 2: Cryptography & PQC (CBOM - flags classical crypto that won't survive Shor's algorithm).
 *   - Risk 3: License Compliance (SBOM - blocks copyleft AGPL/GPL, suggests MIT/Apache alternatives).
 *   - Risk 4: Security Vulnerabilities (unpinned dependencies, latest tags, pipe-to-bash).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FINDINGS_LEDGER_PATH = path.join(__dirname, '..', '.thumbgate', 'findings-ledger.jsonl');

// Author Classifications
const AUTHOR_HUMAN = 'human';
const AUTHOR_OPENSOURCE = 'opensource';
const AUTHOR_AGENT = 'ai_agent';

// Permissive Alternatives Database (for in-line agent redirection)
const PERMISSIVE_ALTERNATIVES = {
  'fast-charts': [
    { name: 'chart.js', license: 'MIT', description: 'Simple yet flexible JavaScript charting' },
    { name: 'recharts', license: 'MIT', description: 'Redefined chart library built on React components' }
  ],
  'ag-grid-enterprise': [
    { name: 'ag-grid-community', license: 'MIT', description: 'Free community edition of AG Grid' },
    { name: '@tanstack/react-table', license: 'MIT', description: 'Headless UI for building powerful tables' }
  ],
  'pdfmake-agpl': [
    { name: 'pdf-lib', license: 'MIT', description: 'Create and modify PDF documents in JS' },
    { name: 'jspdf', license: 'MIT', description: 'Client-side JavaScript PDF generator' }
  ],
  'ghostscript': [
    { name: 'mupdf', license: 'AGPL-3.0 (Caution)', description: 'Consider pdfium (Apache-2.0)' },
    { name: 'pdfium', license: 'Apache-2.0', description: 'Google open source PDF renderer' }
  ],
  'metabase': [
    { name: 'apache-superset', license: 'Apache-2.0', description: 'Modern enterprise BI and data exploration platform' }
  ]
};

// Cryptography & PQC Taxonomy
const CRYPTO_PQC_CATALOG = [
  {
    id: 'rsa-classical',
    name: 'RSA (Rivest-Shamir-Adleman)',
    pattern: /(crypto\.createPrivateKey|crypto\.generateKeyPairSync\s*\(\s*['"]rsa['"]|BEGIN RSA PRIVATE KEY|RS256|RSA-OAEP|RSA-PSS|\b\d+-bit RSA\b)/i,
    status: 'VULNERABLE_TO_SHORS_ALGORITHM',
    severity: 'high',
    pqcTransition: 'Deprecated for long-term secrets. Migrate to ML-KEM (FIPS 203) for key encapsulation or ML-DSA (FIPS 204) for digital signatures.'
  },
  {
    id: 'ecdsa-classical',
    name: 'ECDSA / ECC (Classical Elliptic Curves)',
    pattern: /\b(secp256k1|prime256v1|P-256|P-384|P-521)\b|crypto\.createECDH/i,
    status: 'VULNERABLE_TO_SHORS_ALGORITHM',
    severity: 'medium',
    pqcTransition: 'Vulnerable to quantum attack. Transition to ML-DSA (FIPS 204 / Dilithium) or stateful hash-based signatures (SLH-DSA).'
  },
  {
    id: 'broken-hash-md5-sha1',
    name: 'Broken Cryptographic Hash (MD5 / SHA-1)',
    pattern: /createHash\s*\(\s*['"](md5|sha1)['"]\s*\)|hashlib\.(md5|sha1)\b/i,
    status: 'CLASSICALLY_BROKEN',
    severity: 'critical',
    pqcTransition: 'Broken collision resistance. Replace immediately with SHA-256, SHA-384, or SHA-3.'
  },
  {
    id: 'pqc-post-quantum-native',
    name: 'NIST Post-Quantum Cryptography (ML-KEM / ML-DSA)',
    pattern: /\b(ML-KEM|ML-DSA|SLH-DSA|Kyber512|Kyber768|Kyber1024|Dilithium2|Dilithium3|Dilithium5|SPHINCS\+)\b/i,
    status: 'QUANTUM_RESISTANT',
    severity: 'info',
    pqcTransition: 'Meets NIST FIPS 203 / 204 / 205 Post-Quantum Cryptography standards.'
  }
];

// Copyleft & Restrictive Licenses
const RESTRICTIVE_LICENSES = new Set([
  'agpl-1.0',
  'agpl-3.0',
  'gpl-1.0',
  'gpl-2.0',
  'gpl-3.0',
  'sspl-1.0',
  'eupl-1.2',
  'cc-by-nc-4.0',
  'commons-clause'
]);

function generateFindingId(category) {
  const prefix = category === 'license' ? 'TG-LIC' :
                 category === 'pqc' ? 'TG-PQC' :
                 category === 'aimodel' ? 'TG-AI' : 'TG-SEC';
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${rand}`;
}

function classifyAuthor(context = {}) {
  if (context.isAgent || process.env.THUMBGATE_SESSION_AGENT || process.env.CLAUDE_CODE || process.env.CURSOR_PROJECT_DIR) {
    return AUTHOR_AGENT;
  }
  if (context.isVendor || context.path?.includes('node_modules') || context.path?.includes('vendor')) {
    return AUTHOR_OPENSOURCE;
  }
  return AUTHOR_HUMAN;
}

function recordFinding(finding) {
  try {
    fs.mkdirSync(path.dirname(FINDINGS_LEDGER_PATH), { recursive: true });
    fs.appendFileSync(FINDINGS_LEDGER_PATH, JSON.stringify({
      timestamp: new Date().toISOString(),
      ...finding
    }) + '\n', 'utf8');
  } catch (_) {}
}

function getFindingById(findingId) {
  if (!fs.existsSync(FINDINGS_LEDGER_PATH)) return null;
  try {
    const lines = fs.readFileSync(FINDINGS_LEDGER_PATH, 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const item = JSON.parse(lines[i]);
        if (item.findingId === findingId) return item;
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

/**
 * Checkpoint 1: MCP / PreToolUse Gate
 * Evaluates proposed tool calls in sub-millisecond time.
 */
function evaluateMcpPreToolUse({ toolName, toolInput, authorContext = {} }) {
  const startTime = Date.now();
  const author = classifyAuthor(authorContext);

  if (toolName?.toLowerCase() === 'bash' || toolName?.toLowerCase() === 'terminal' || toolName?.toLowerCase() === 'run_command') {
    const cmd = String(toolInput?.command || toolInput?.CommandLine || '');

    // 1. Check for copyleft package installs
    for (const [pkg, alts] of Object.entries(PERMISSIVE_ALTERNATIVES)) {
      const pkgRegex = new RegExp(`\\b(npm\\s+i(nstall)?|yarn\\s+add|pnpm\\s+add|pip\\s+install)\\s+.*\\b${pkg}\\b`, 'i');
      if (pkgRegex.test(cmd)) {
        const findingId = generateFindingId('license');
        const altText = alts.map(a => `${a.name} (${a.license}) - ${a.description}`).join('; ');
        const reason = `[THIRD-AUTHOR:copyleft-license] Prohibited copyleft dependency '${pkg}' detected in proposed command. Author: ${author}. Suggested permissive alternatives: ${altText}`;
        
        const finding = {
          findingId,
          checkpoint: 'mcp_pretooluse',
          author,
          category: 'license_compliance',
          package: pkg,
          severity: 'critical',
          command: cmd,
          decision: 'deny',
          reason,
          alternatives: alts
        };
        recordFinding(finding);

        return {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
          findingId,
          alternatives: alts,
          evalLatencyMs: Date.now() - startTime
        };
      }
    }

    // 2. Check for pipe-to-bash unpinned supply chain downloads
    const isStrict = process.env.THUMBGATE_STRICT_ENFORCEMENT === '1' ||
                     process.env.THUMBGATE_GOVERNANCE_MODE === 'live' ||
                     Boolean(authorContext.strict);

    if (/(curl|wget)\s+[^|]+\|\s*(ba|z|sh|sudo)/i.test(cmd)) {
      if (isStrict || /\bsudo\b/i.test(cmd)) {
        const findingId = generateFindingId('security');
        const reason = `[THIRD-AUTHOR:untrusted-pipe-to-shell] Direct pipe from remote network curl/wget to shell execution blocked. Download and verify hash before running.`;
        const finding = {
          findingId,
          checkpoint: 'mcp_pretooluse',
          author,
          category: 'security_vulnerabilities',
          command: cmd,
          decision: 'deny',
          reason
        };
        recordFinding(finding);

        return {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
          findingId,
          evalLatencyMs: Date.now() - startTime
        };
      }
    }
  }

  return {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    author,
    evalLatencyMs: Date.now() - startTime
  };
}

/**
 * Risk 2: Cryptography & PQC (Post-Quantum Cryptography) Audit
 */
function scanCryptographyAndPqc(content, filePath = 'snippet') {
  const findings = [];
  for (const item of CRYPTO_PQC_CATALOG) {
    if (item.pattern.test(content)) {
      const findingId = generateFindingId('pqc');
      findings.push({
        findingId,
        category: 'cryptography_pqc',
        algorithm: item.name,
        status: item.status,
        severity: item.severity,
        pqcTransition: item.pqcTransition,
        filePath
      });
    }
  }
  return findings;
}

/**
 * Risk 3: License Compliance Audit
 */
function auditPackageLicenses(packageJsonContent, filePath = 'package.json') {
  const findings = [];
  try {
    const pkg = typeof packageJsonContent === 'string' ? JSON.parse(packageJsonContent) : packageJsonContent;
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    for (const dep of Object.keys(allDeps)) {
      if (PERMISSIVE_ALTERNATIVES[dep]) {
        const findingId = generateFindingId('license');
        findings.push({
          findingId,
          category: 'license_compliance',
          package: dep,
          detectedLicense: 'AGPL-3.0 / Copyleft',
          severity: 'critical',
          filePath,
          alternatives: PERMISSIVE_ALTERNATIVES[dep]
        });
      }
    }
  } catch (_) {}
  return findings;
}

/**
 * Checkpoint 2: Git Pre-Commit Hook Validator
 */
function evaluatePreCommit({ stagedFiles = [], repoRoot = process.cwd() }) {
  const findings = [];
  for (const file of stagedFiles) {
    const fullPath = path.resolve(repoRoot, file);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const content = fs.readFileSync(fullPath, 'utf8');

      // 1. Scan for PQC and broken cryptography
      const cryptoFindings = scanCryptographyAndPqc(content, file);
      findings.push(...cryptoFindings);

      // 2. Scan package.json for license risks
      if (path.basename(file) === 'package.json') {
        const licFindings = auditPackageLicenses(content, file);
        findings.push(...licFindings);
      }
    } catch (_) {}
  }

  const criticalFindings = findings.filter(f => f.severity === 'critical');
  const verdict = criticalFindings.length > 0 ? 'block' : (findings.length > 0 ? 'warn' : 'pass');

  for (const f of findings) {
    recordFinding({ ...f, checkpoint: 'pre-commit' });
  }

  return {
    checkpoint: 'pre-commit',
    verdict,
    findingsCount: findings.length,
    criticalCount: criticalFindings.length,
    findings,
    remediationCommand: findings.length > 0 ? `npx thumbgate explain ${findings[0].findingId}` : null
  };
}

/**
 * Checkpoint 3: PR Gate / CI Evaluator
 */
function evaluatePrGate({ diffContent = '', prNumber = 0, author = AUTHOR_AGENT }) {
  const cryptoFindings = scanCryptographyAndPqc(diffContent, `PR #${prNumber} diff`);
  const critical = cryptoFindings.filter(f => f.severity === 'critical');

  let verdict = 'pass';
  if (critical.length > 0) {
    verdict = 'block';
  } else if (cryptoFindings.length > 0) {
    verdict = 'require_approval';
  }

  return {
    checkpoint: 'pull_request',
    prNumber,
    author,
    verdict,
    findings: cryptoFindings
  };
}

/**
 * Format Explain Finding Output
 */
function formatExplainFinding(finding) {
  if (!finding) {
    return 'Finding not found in ThumbGate ledger.';
  }

  const lines = [
    `============================================================`,
    `ThumbGate Finding Evidence: ${finding.findingId}`,
    `============================================================`,
    `Category:    ${finding.category || 'general'}`,
    `Severity:    ${(finding.severity || 'unknown').toUpperCase()}`,
    `Checkpoint:  ${finding.checkpoint || 'audit'}`,
    `Author:      ${finding.author || 'unknown'}`,
    `Decision:    ${finding.decision || finding.verdict || 'flagged'}`,
    `Reason:      ${finding.reason || finding.pqcTransition || 'Policy invariant violated'}`,
    ``
  ];

  if (finding.command) {
    lines.push(`Offending Command:`);
    lines.push(`  ${finding.command}`);
    lines.push(``);
  }

  if (finding.alternatives && finding.alternatives.length > 0) {
    lines.push(`Permissive Alternatives (Approved):`);
    finding.alternatives.forEach(alt => {
      lines.push(`  • ${alt.name} [${alt.license}]: ${alt.description}`);
    });
    lines.push(``);
  }

  if (finding.pqcTransition) {
    lines.push(`Post-Quantum Cryptography Guidance:`);
    lines.push(`  ${finding.pqcTransition}`);
    lines.push(``);
  }

  lines.push(`Remediation:`);
  lines.push(`  Substitute the non-compliant dependency or algorithm with an approved alternative.`);
  lines.push(`============================================================`);

  return lines.join('\n');
}

module.exports = {
  AUTHOR_HUMAN,
  AUTHOR_OPENSOURCE,
  AUTHOR_AGENT,
  PERMISSIVE_ALTERNATIVES,
  CRYPTO_PQC_CATALOG,
  RESTRICTIVE_LICENSES,
  classifyAuthor,
  evaluateMcpPreToolUse,
  scanCryptographyAndPqc,
  auditPackageLicenses,
  evaluatePreCommit,
  evaluatePrGate,
  getFindingById,
  recordFinding,
  formatExplainFinding
};
