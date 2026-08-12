#!/usr/bin/env node
/**
 * Offline Pre-ECI Asset & Provenance Archive Generator
 * 
 * Generates an immutable, cryptographic snapshot of all ThumbGate source code,
 * git commit logs, npm manifests, and legal disclosures prior to employment start date.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const ARCHIVE_DIR = path.join(ROOT_DIR, 'archive', 'pre-eci-20260831');

console.log('📦 Starting ThumbGate Pre-ECI Provenance Archive Generation...');

// 1. Ensure target directory exists
if (!fs.existsSync(ARCHIVE_DIR)) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

// 2. Capture Git Bundle
const bundlePath = path.join(ARCHIVE_DIR, 'thumbgate-pre-eci.bundle');
try {
  execSync(`git bundle create "${bundlePath}" --all`, { cwd: ROOT_DIR });
  console.log(`  ✓ Git bundle created: ${path.relative(ROOT_DIR, bundlePath)}`);
} catch (err) {
  console.error(`  ✗ Git bundle failed: ${err.message}`);
}

// 3. Capture Git Commit History Log
const gitLogPath = path.join(ARCHIVE_DIR, 'git-commit-history.log');
try {
  const logOutput = execSync('git log --format="%H | %an | %ad | %s"', { cwd: ROOT_DIR, encoding: 'utf-8' });
  fs.writeFileSync(gitLogPath, logOutput);
  console.log(`  ✓ Git commit log saved: ${path.relative(ROOT_DIR, gitLogPath)}`);
} catch (err) {
  console.error(`  ✗ Git log failed: ${err.message}`);
}

// 4. Capture Head SHA and Tag Metadata
let headSha = 'UNKNOWN';
try {
  headSha = execSync('git rev-parse HEAD', { cwd: ROOT_DIR, encoding: 'utf-8' }).trim();
} catch {}

// 5. Generate Manifest & SHA-256 Checksums
const manifest = {
  projectName: 'ThumbGate',
  owner: 'Igor Ganapolsky',
  archiveTimestamp: new Date().toISOString(),
  gitHeadSha: headSha,
  npmPackage: 'thumbgate',
  domains: ['thumbgate.ai', 'thumbgate.app'],
  legalDocuments: [
    'docs/legal/EXHIBIT_A_PRIOR_INVENTIONS_DISCLOSURE.md',
    'docs/legal/ECI_CARVEOUT_AND_WRITTEN_PERMISSION_REQUEST.md',
    'docs/legal/ECI_IP_CLEANROOM_AND_SEPARATION_POLICY.md',
    'docs/legal/PRODUCT_COUNSEL_CHECKLIST.md',
    'THIRD_PARTY_NOTICES.md'
  ],
  sha256Checksums: {}
};

// Compute hashes for legal docs
manifest.legalDocuments.forEach(docRelPath => {
  const fullPath = path.join(ROOT_DIR, docRelPath);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    manifest.sha256Checksums[docRelPath] = hash;
  }
});

const manifestPath = path.join(ARCHIVE_DIR, 'PROVENANCE_MANIFEST.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`  ✓ Provenance manifest written: ${path.relative(ROOT_DIR, manifestPath)}`);

console.log('\n🔒 Archive Generation Complete!');
console.log(`  Root Archive Path: ${ARCHIVE_DIR}`);
console.log(`  Git HEAD SHA: ${headSha}`);
