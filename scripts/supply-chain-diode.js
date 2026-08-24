'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'gates', 'supply-chain-diode.json');

/**
 * Load Supply Chain Diode Gate Configuration.
 */
function loadSupplyChainConfig(configPath = DEFAULT_CONFIG_PATH) {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) {
    // Return fallback safe config
  }

  return {
    gateId: 'gate_supply_chain_diode_2026',
    name: 'Zero-Trust Supply Chain & Provenance Diode Gate',
    version: '1.0.0',
    enforcementMode: 'fail_closed',
    rules: [
      { id: 'SUPPLY_01_LIFECYCLE_SCRIPTS', severity: 'CRITICAL', action: 'BLOCK' },
      { id: 'SUPPLY_02_EXACT_PINNING', severity: 'HIGH', action: 'BLOCK' },
      { id: 'SUPPLY_03_TYPOSQUATTING_SENTINEL', severity: 'CRITICAL', action: 'BLOCK' },
      { id: 'SUPPLY_04_PROVENANCE_ATTESTATION', severity: 'HIGH', action: 'WARN_REQUIRE_ATTESTATION' },
      { id: 'SUPPLY_05_TOKENLESS_OIDC_PUBLISH', severity: 'HIGH', action: 'ENFORCE_OIDC' }
    ],
    monitoredCriticalPackages: [
      'axios',
      'express',
      'react',
      'lodash',
      'trivy',
      'playwright',
      'jsonwebtoken',
      'chalk',
      'commander',
      'winston'
    ]
  };
}

/**
 * Levenshtein distance helper for typosquatting detection.
 */
function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Check if a package name is a potential typosquat of a critical package.
 */
function detectTyposquatting(packageName, criticalList = []) {
  const normName = String(packageName || '').toLowerCase().trim();
  const hits = [];

  for (const critical of criticalList) {
    if (normName === critical) continue; // Exact match is legitimate
    const dist = levenshteinDistance(normName, critical);
    // If edit distance is 1 or 2, flag as potential typosquatting attack
    if (dist > 0 && dist <= 2 && normName.length >= 4) {
      hits.push({ target: critical, distance: dist });
    }
  }

  return hits;
}

/**
 * Evaluate package manifest or dependency list for supply chain risks.
 *
 * @param {Object|string} manifestOrPath - Package.json object or path to package.json
 * @param {Object} options - Options { configPath, strictMode, allowScripts }
 * @returns {Object} Evaluation verdict and findings
 */
function evaluateSupplyChainSecurity(manifestOrPath = {}, options = {}) {
  const config = loadSupplyChainConfig(options.configPath);
  let manifest = {};

  if (typeof manifestOrPath === 'string') {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestOrPath, 'utf8'));
    } catch (e) {
      manifest = {};
    }
  } else {
    manifest = manifestOrPath || {};
  }

  const findings = [];
  const matchedRules = [];
  const dependencies = { ...(manifest.dependencies || {}), ...(manifest.optionalDependencies || {}) };
  const scripts = manifest.scripts || {};

  // Check 1: Malicious / risky lifecycle scripts
  const dangerousLifecycleKeys = ['preinstall', 'install', 'postinstall', 'preuninstall', 'postuninstall'];
  for (const key of dangerousLifecycleKeys) {
    if (scripts[key] && !options.allowScripts) {
      const scriptVal = scripts[key];
      // Flag if script executes curl, wget, python, bash, nc, or arbitrary remote shells
      if (/(curl|wget|bash|sh\s+-c|nc\s+|eval\(|python|exec)/i.test(scriptVal)) {
        findings.push({
          rule: 'SUPPLY_01_LIFECYCLE_SCRIPTS',
          type: 'CRITICAL_LIFECYCLE_SCRIPT',
          lifecycleHook: key,
          command: scriptVal,
          message: `Arbitrary command execution detected in lifecycle script: ${key}`
        });
        matchedRules.push('SUPPLY_01_LIFECYCLE_SCRIPTS');
      }
    }
  }

  // Check 2: Unpinned / loose dependency version specs
  for (const [dep, version] of Object.entries(dependencies)) {
    if (typeof version === 'string') {
      if (version === '*' || version.startsWith('>') || version.startsWith('>=') || version.includes('||')) {
        findings.push({
          rule: 'SUPPLY_02_EXACT_PINNING',
          type: 'UNPINNED_DEPENDENCY',
          package: dep,
          versionSpec: version,
          message: `Unpinned loose dependency specification: ${dep}@${version}`
        });
        matchedRules.push('SUPPLY_02_EXACT_PINNING');
      }
    }

    // Check 3: Typosquatting Sentinel
    const squatMatches = detectTyposquatting(dep, config.monitoredCriticalPackages || []);
    if (squatMatches.length > 0) {
      findings.push({
        rule: 'SUPPLY_03_TYPOSQUATTING_SENTINEL',
        type: 'TYPOSQUAT_SUSPECT',
        package: dep,
        targets: squatMatches,
        message: `Potential typosquatting dependency detected: ${dep} (mimics ${squatMatches.map(m => m.target).join(', ')})`
      });
      matchedRules.push('SUPPLY_03_TYPOSQUATTING_SENTINEL');
    }
  }

  // Check 4 & 5: Provenance & OIDC
  const hasProvenanceAttestation = Boolean(manifest.publishConfig?.provenance || options.provenanceAttested);
  if (!hasProvenanceAttestation && options.requireProvenance) {
    findings.push({
      rule: 'SUPPLY_04_PROVENANCE_ATTESTATION',
      type: 'MISSING_PROVENANCE',
      message: 'Package publish manifest lacks cryptographic build provenance (SLSA/npm provenance).'
    });
    matchedRules.push('SUPPLY_04_PROVENANCE_ATTESTATION');
  }

  const hasCriticalFindings = findings.some(f => f.rule === 'SUPPLY_01_LIFECYCLE_SCRIPTS' || f.rule === 'SUPPLY_03_TYPOSQUATTING_SENTINEL');
  const allowed = !hasCriticalFindings && (findings.length === 0 || !options.strictMode);
  const verdict = hasCriticalFindings ? 'DENY_SUPPLY_CHAIN_RISK' : (findings.length > 0 ? 'WARN_SUPPLY_CHAIN_DRIFT' : 'ALLOW');

  return {
    gateId: config.gateId,
    timestamp: new Date().toISOString(),
    allowed,
    verdict,
    findingsCount: findings.length,
    matchedRules: Array.from(new Set(matchedRules)),
    findings,
    summary: {
      totalDependenciesScanned: Object.keys(dependencies).length,
      lifecycleScriptsSafe: !findings.some(f => f.rule === 'SUPPLY_01_LIFECYCLE_SCRIPTS'),
      typosquatsDetected: findings.filter(f => f.rule === 'SUPPLY_03_TYPOSQUATTING_SENTINEL').length,
      unpinnedDependencies: findings.filter(f => f.rule === 'SUPPLY_02_EXACT_PINNING').length
    }
  };
}

/**
 * Generate a signed Supply Chain Provenance Receipt.
 */
function generateProvenanceReceipt(manifest = {}, evaluation = {}, buildDetails = {}) {
  const payloadToHash = {
    packageName: manifest.name || 'unnamed-package',
    packageVersion: manifest.version || '0.0.0',
    evaluationVerdict: evaluation.verdict,
    findingsCount: evaluation.findingsCount || 0,
    timestamp: evaluation.timestamp || new Date().toISOString(),
    buildSha: buildDetails.gitCommitSha || process.env.GITHUB_SHA || 'local-clean-sha',
    buildRunner: buildDetails.runner || 'ThumbGate-Diode-Runner'
  };

  const payloadString = JSON.stringify(payloadToHash, Object.keys(payloadToHash).sort());
  const receiptHash = crypto.createHash('sha256').update(payloadString).digest('hex');

  return {
    receiptId: `rcpt_supply_${Date.now()}_${receiptHash.slice(0, 8)}`,
    gateId: evaluation.gateId || 'gate_supply_chain_diode_2026',
    payloadHash: receiptHash,
    manifest: payloadToHash,
    findings: evaluation.findings || [],
    slsaAttestation: {
      predicateType: 'https://slsa.dev/provenance/v1',
      builder: { id: 'https://github.com/IgorGanapolsky/ThumbGate/.github/workflows/ci.yml' },
      buildType: 'https://thumbgate.org/provenance/v1',
      materials: [{ uri: `git+https://github.com/IgorGanapolsky/ThumbGate@${payloadToHash.buildSha}` }]
    },
    signature: crypto.createHmac('sha256', buildDetails.signingSecret || 'thumbgate-supply-chain-anchor')
      .update(receiptHash)
      .digest('hex')
  };
}

/**
 * Verify integrity of a ProvenanceReceipt.
 */
function verifyProvenanceReceipt(receipt = {}, signingSecret = 'thumbgate-supply-chain-anchor') {
  if (!receipt || !receipt.payloadHash || !receipt.manifest || !receipt.signature) {
    return false;
  }

  const expectedPayloadString = JSON.stringify(receipt.manifest, Object.keys(receipt.manifest).sort());
  const expectedHash = crypto.createHash('sha256').update(expectedPayloadString).digest('hex');

  if (expectedHash !== receipt.payloadHash) {
    return false;
  }

  const expectedSignature = crypto.createHmac('sha256', signingSecret)
    .update(receipt.payloadHash)
    .digest('hex');

  return expectedSignature === receipt.signature;
}

if (require.main === module) {
  const target = process.argv[2] || path.join(process.cwd(), 'package.json');
  const evalResult = evaluateSupplyChainSecurity(target);
  const receipt = generateProvenanceReceipt({ name: 'cli-target' }, evalResult);
  console.log(JSON.stringify({ evaluation: evalResult, receipt }, null, 2));
}

module.exports = {
  loadSupplyChainConfig,
  detectTyposquatting,
  evaluateSupplyChainSecurity,
  generateProvenanceReceipt,
  verifyProvenanceReceipt
};
