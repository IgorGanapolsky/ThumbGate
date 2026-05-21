#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

// Risk window: default 24 hours (86400000 ms)
const COOLDOWN_HOURS = parseInt(process.env.DEPENDENCY_COOLDOWN_HOURS || '24', 10);
const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;
const STRICT_MODE = process.env.STRICT_DEPENDENCY_COOLDOWN === '1';

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageLockJsonPath = path.join(__dirname, '..', 'package-lock.json');

function getDependencies() {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return Object.keys(deps);
  } catch (err) {
    console.error('Failed to read package.json:', err.message);
    process.exit(1);
  }
}

function getResolvedVersion(name) {
  try {
    if (fs.existsSync(packageLockJsonPath)) {
      const lock = JSON.parse(fs.readFileSync(packageLockJsonPath, 'utf8'));
      if (lock.packages && lock.packages[`node_modules/${name}`]) {
        return lock.packages[`node_modules/${name}`].version;
      }
      if (lock.dependencies && lock.dependencies[name]) {
        return lock.dependencies[name].version;
      }
    }
  } catch (_) {}
  
  // Fallback to package.json spec (strip semver symbols)
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const spec = pkg.dependencies[name] || pkg.devDependencies[name];
    if (spec) {
      return spec.replace(/^[\^~>=<]+/, '');
    }
  } catch (_) {}
  
  return null;
}

function fetchPublishTime(name, version) {
  return new Promise((resolve) => {
    // Support dry-run or mock for testing
    if (process.env.THUMBGATE_MOCK_COOLDOWN === '1') {
      if (process.env.THUMBGATE_MOCK_VIOLATION === name) {
        return resolve({ name, version, time: new Date(Date.now() - 3600000) }); // 1 hour ago
      }
      return resolve({ name, version, time: new Date(Date.now() - 100 * 3600000) }); // 100 hours ago
    }

    const url = `https://registry.npmjs.org/${name.replace('/', '%2F')}`;
    
    https.get(url, { headers: { 'User-Agent': 'thumbgate-cooldown-check' }, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            return resolve({ name, version, error: `HTTP ${res.statusCode}` });
          }
          const json = JSON.parse(data);
          const time = json.time;
          if (!time) {
            return resolve({ name, version, error: 'No time metadata found' });
          }
          const publishTimeStr = time[version];
          if (!publishTimeStr) {
            return resolve({ name, version, error: `No release time found for version ${version}` });
          }
          resolve({ name, version, time: new Date(publishTimeStr) });
        } catch (err) {
          resolve({ name, version, error: err.message });
        }
      });
    }).on('error', (err) => {
      resolve({ name, version, error: err.message });
    });
  });
}

async function main() {
  console.log(`[dependency-cooldown-check] Risk window configured: ${COOLDOWN_HOURS} hours`);
  const deps = getDependencies();
  console.log(`[dependency-cooldown-check] Scanning ${deps.length} direct dependencies...`);
  
  const promises = deps.map(async (name) => {
    const version = getResolvedVersion(name);
    if (!version) {
      return { name, error: 'Could not resolve version' };
    }
    return fetchPublishTime(name, version);
  });
  
  const results = await Promise.all(promises);
  const now = new Date();
  let violations = 0;
  let skipped = 0;
  
  for (const r of results) {
    if (r.error) {
      console.warn(`⚠️ [dependency-cooldown-check] Skip ${r.name}: ${r.error}`);
      skipped++;
      continue;
    }
    
    const ageMs = now - r.time;
    const ageHours = (ageMs / (1000 * 60 * 60)).toFixed(1);
    
    if (ageMs < COOLDOWN_MS) {
      console.error(`🚨 [dependency-cooldown-check] VIOLATION: package "${r.name}@${r.version}" was published only ${ageHours} hours ago (limit: ${COOLDOWN_HOURS}h)!`);
      violations++;
    } else {
      console.log(`✅ [dependency-cooldown-check] ${r.name}@${r.version} passed (published ${ageHours}h ago)`);
    }
  }
  
  if (violations > 0) {
    console.error(`\n❌ [dependency-cooldown-check] FAILED: Found ${violations} dependency violation(s). Prevent potential supply-chain zero-day attacks!`);
    process.exit(1);
  }
  
  if (skipped > 0 && STRICT_MODE) {
    console.error(`\n❌ [dependency-cooldown-check] FAILED: ${skipped} package scans skipped in strict mode.`);
    process.exit(1);
  }
  
  console.log('\n✨ [dependency-cooldown-check] SUCCESS: All direct dependencies meet the cooldown security check.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[dependency-cooldown-check] Critical error:', err);
  process.exit(1);
});
