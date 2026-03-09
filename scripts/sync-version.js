#!/usr/bin/env node
'use strict';
/**
 * Version Sync — Single Source of Truth
 *
 * Reads the version from package.json and propagates it to all
 * manifests and public docs. Eliminates version drift permanently.
 *
 * Inspired by the "Pipeline Doctor" pattern (Optimum Partners, 2026)
 * and OneUptime's automated version bumping approach.
 *
 * Usage:
 *   node scripts/sync-version.js          # Sync all files
 *   node scripts/sync-version.js --check  # Dry-run: report drift without fixing
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, relPath), 'utf-8'));
}

function writeJson(relPath, data) {
  fs.writeFileSync(path.join(PROJECT_ROOT, relPath), JSON.stringify(data, null, 2) + '\n');
}

function replaceInFile(relPath, search, replace) {
  const filePath = path.join(PROJECT_ROOT, relPath);
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.includes(search)) return false;
  fs.writeFileSync(filePath, content.split(search).join(replace));
  return true;
}

function syncVersion(opts) {
  const options = opts || {};
  const checkOnly = options.check || false;
  const pkg = readJson('package.json');
  const version = pkg.version;

  const targets = [];
  const drifted = [];

  // 1. server.json — top-level version + packages[0].version
  const serverJson = readJson('server.json');
  if (serverJson.version !== version) {
    drifted.push({ file: 'server.json', field: 'version', current: serverJson.version });
    if (!checkOnly) {
      serverJson.version = version;
      if (serverJson.packages && serverJson.packages[0]) {
        serverJson.packages[0].version = version;
      }
      writeJson('server.json', serverJson);
    }
  } else if (serverJson.packages && serverJson.packages[0] && serverJson.packages[0].version !== version) {
    drifted.push({ file: 'server.json', field: 'packages[0].version', current: serverJson.packages[0].version });
    if (!checkOnly) {
      serverJson.packages[0].version = version;
      writeJson('server.json', serverJson);
    }
  }
  targets.push('server.json');

  // 2. .well-known/mcp/server-card.json
  const cardPath = '.well-known/mcp/server-card.json';
  if (fs.existsSync(path.join(PROJECT_ROOT, cardPath))) {
    const card = readJson(cardPath);
    if (card.version !== version) {
      drifted.push({ file: cardPath, field: 'version', current: card.version });
      if (!checkOnly) {
        card.version = version;
        writeJson(cardPath, card);
      }
    }
    targets.push(cardPath);
  }

  // 3. docs/landing-page.html — hero badge + JSON snippet
  const landingPath = 'docs/landing-page.html';
  if (fs.existsSync(path.join(PROJECT_ROOT, landingPath))) {
    const landingContent = fs.readFileSync(path.join(PROJECT_ROOT, landingPath), 'utf-8');
    // Match any version pattern in the hero badge
    const badgeMatch = landingContent.match(/v(\d+\.\d+\.\d+) — Hosted API/);
    if (badgeMatch && badgeMatch[1] !== version) {
      drifted.push({ file: landingPath, field: 'hero-badge', current: badgeMatch[1] });
      if (!checkOnly) {
        replaceInFile(landingPath, `v${badgeMatch[1]} — Hosted API`, `v${version} — Hosted API`);
      }
    }
    // JSON snippet version
    const jsonMatch = landingContent.match(/"version"<\/span><span class="out">: <\/span><span class="val">"(\d+\.\d+\.\d+)"/);
    if (jsonMatch && jsonMatch[1] !== version) {
      drifted.push({ file: landingPath, field: 'json-snippet', current: jsonMatch[1] });
      if (!checkOnly) {
        replaceInFile(landingPath, `"${jsonMatch[1]}"</div>`, `"${version}"</div>`);
      }
    }
    targets.push(landingPath);
  }

  // 4. docs/mcp-hub-submission.md
  const mcpSubmPath = 'docs/mcp-hub-submission.md';
  if (fs.existsSync(path.join(PROJECT_ROOT, mcpSubmPath))) {
    const mcpContent = fs.readFileSync(path.join(PROJECT_ROOT, mcpSubmPath), 'utf-8');
    const versionMatch = mcpContent.match(/## Version\s+(\d+\.\d+\.\d+)/);
    if (versionMatch && versionMatch[1] !== version) {
      drifted.push({ file: mcpSubmPath, field: 'version-heading', current: versionMatch[1] });
      if (!checkOnly) {
        replaceInFile(mcpSubmPath, versionMatch[1], version);
      }
    }
    targets.push(mcpSubmPath);
  }

  return {
    version,
    targets,
    drifted,
    synced: !checkOnly && drifted.length > 0,
    allInSync: drifted.length === 0,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const checkOnly = process.argv.includes('--check');
  const result = syncVersion({ check: checkOnly });

  if (result.allInSync) {
    console.log(`✔ All ${result.targets.length} targets in sync at v${result.version}`);
    process.exit(0);
  }

  if (checkOnly) {
    console.error(`✖ Version drift detected (package.json = ${result.version}):`);
    result.drifted.forEach((d) => {
      console.error(`  ${d.file} [${d.field}] = ${d.current}`);
    });
    process.exit(1);
  }

  console.log(`✔ Synced ${result.drifted.length} targets to v${result.version}:`);
  result.drifted.forEach((d) => {
    console.log(`  ${d.file} [${d.field}]: ${d.current} → ${result.version}`);
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { syncVersion };
