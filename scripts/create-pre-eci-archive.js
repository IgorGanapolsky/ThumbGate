#!/usr/bin/env node
/**
 * Offline pre-employment provenance archive generator.
 *
 * Snapshots public ThumbGate source via git bundle + commit log + SHA-256 of
 * selected public legal/disclosure files. Operator utility (npm run archive:pre-eci).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const ARCHIVE_DIR = path.join(ROOT_DIR, 'archive', 'pre-eci-20260831');
// Fixed absolute path — do not resolve `git` via PATH (Sonar S4036).
const GIT_BIN = process.env.GIT_BIN || '/usr/bin/git';

function git(args, encoding) {
  return execFileSync(GIT_BIN, args, {
    cwd: ROOT_DIR,
    encoding: encoding || undefined,
    stdio: encoding ? ['ignore', 'pipe', 'pipe'] : undefined,
  });
}

console.log('Starting ThumbGate provenance archive generation...');

if (!fs.existsSync(ARCHIVE_DIR)) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

const bundlePath = path.join(ARCHIVE_DIR, 'thumbgate-pre-eci.bundle');
try {
  git(['bundle', 'create', bundlePath, '--all']);
  console.log(`  OK git bundle: ${path.relative(ROOT_DIR, bundlePath)}`);
} catch (err) {
  console.error(`  FAIL git bundle: ${err.message}`);
}

const gitLogPath = path.join(ARCHIVE_DIR, 'git-commit-history.log');
try {
  const logOutput = git(['log', '--format=%H | %an | %ad | %s'], 'utf8');
  fs.writeFileSync(gitLogPath, logOutput);
  console.log(`  OK git log: ${path.relative(ROOT_DIR, gitLogPath)}`);
} catch (err) {
  console.error(`  FAIL git log: ${err.message}`);
}

let headSha = 'UNKNOWN';
try {
  headSha = String(git(['rev-parse', 'HEAD'], 'utf8')).trim();
} catch {
  // keep UNKNOWN
}

const manifest = {
  projectName: 'ThumbGate',
  owner: 'Igor Ganapolsky',
  archiveTimestamp: new Date().toISOString(),
  gitHeadSha: headSha,
  npmPackage: 'thumbgate',
  domains: ['thumbgate.ai', 'thumbgate.app'],
  legalDocuments: [
    'docs/legal/PRODUCT_COUNSEL_CHECKLIST.md',
    'docs/legal/COMMERCIAL_LEGAL_FIRST_PASS.md',
    'docs/legal/COMMERCIAL_LICENSING_BOUNDARY.md',
    'THIRD_PARTY_NOTICES.md',
  ],
  sha256Checksums: {},
};

for (const docRelPath of manifest.legalDocuments) {
  const fullPath = path.join(ROOT_DIR, docRelPath);
  if (!fs.existsSync(fullPath)) continue;
  const content = fs.readFileSync(fullPath);
  manifest.sha256Checksums[docRelPath] = crypto.createHash('sha256').update(content).digest('hex');
}

const manifestPath = path.join(ARCHIVE_DIR, 'PROVENANCE_MANIFEST.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`  OK manifest: ${path.relative(ROOT_DIR, manifestPath)}`);
console.log(`Archive complete at ${ARCHIVE_DIR} (HEAD ${headSha})`);
