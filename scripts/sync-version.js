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
const VERSION_PATTERN = '\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?';

function explicitPinnedServeArgs(version) {
  return ['--yes', '--package', `thumbgate@${version}`, 'thumbgate', 'serve'];
}

function explicitLatestServeArgs() {
  return ['--yes', '--package', 'thumbgate@latest', 'thumbgate', 'serve'];
}

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

function syncJsonField(target, field, expectedValue, drifted, checkOnly) {
  if (field !== 'version' && field !== 'homepage' && field !== 'repository') return false;
  if (target[field] === expectedValue) return false;
  drifted.push({ file: target.__file, field, current: target[field] });
  if (!checkOnly) target[field] = expectedValue;
  return true;
}

function syncVersion(opts) {
  const options = opts || {};
  const checkOnly = options.check || options.checkOnly || false;
  const pkg = readJson('package.json');
  const version = pkg.version;
  const homepageUrl = pkg.homepage;
  const repositoryUrl = pkg.repository && pkg.repository.url ? String(pkg.repository.url).replace(/\.git$/, '') : '';

  const targets = [];
  const drifted = [];

  // 1. package-lock.json — top-level version metadata
  const packageLockPath = 'package-lock.json';
  if (fs.existsSync(path.join(PROJECT_ROOT, packageLockPath))) {
    const packageLock = readJson(packageLockPath);
    if (packageLock.version !== version) {
      drifted.push({ file: packageLockPath, field: 'version', current: packageLock.version });
      if (!checkOnly) {
        packageLock.version = version;
      }
    }
    if (packageLock.packages && packageLock.packages[''] && packageLock.packages[''].version !== version) {
      drifted.push({ file: packageLockPath, field: 'packages[""].version', current: packageLock.packages[''].version });
      if (!checkOnly) {
        packageLock.packages[''].version = version;
      }
    }
    if (!checkOnly && drifted.some((entry) => entry.file === packageLockPath)) {
      writeJson(packageLockPath, packageLock);
    }
    targets.push(packageLockPath);
  }

  // 2. server.json — top-level version + packages[0].version
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

  // 3. .well-known MCP discovery surfaces
  for (const cardPath of [
    '.well-known/mcp.json',
    '.well-known/mcp/server-card.json',
    '.well-known/mcp/tools.json',
    '.well-known/mcp/skills.json',
    '.well-known/mcp/applications.json',
  ]) {
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
  }

  // 4. .claude-plugin/plugin.json
  const claudePluginPath = '.claude-plugin/plugin.json';
  if (fs.existsSync(path.join(PROJECT_ROOT, claudePluginPath))) {
    const claudePlugin = readJson(claudePluginPath);
    claudePlugin.__file = claudePluginPath;
    const changed = [
      syncJsonField(claudePlugin, 'version', version, drifted, checkOnly),
      syncJsonField(claudePlugin, 'homepage', homepageUrl, drifted, checkOnly),
      syncJsonField(claudePlugin, 'repository', repositoryUrl, drifted, checkOnly),
    ].some(Boolean);
    delete claudePlugin.__file;
    if (!checkOnly && changed) {
      writeJson(claudePluginPath, claudePlugin);
    }
    targets.push(claudePluginPath);
  }

  // 5. .claude-plugin/marketplace.json
  const claudeMarketplacePath = '.claude-plugin/marketplace.json';
  if (fs.existsSync(path.join(PROJECT_ROOT, claudeMarketplacePath))) {
    const claudeMarketplace = readJson(claudeMarketplacePath);
    let changed = false;
    if (claudeMarketplace.version !== version) {
      drifted.push({ file: claudeMarketplacePath, field: 'version', current: claudeMarketplace.version });
      if (!checkOnly) {
        claudeMarketplace.version = version;
        changed = true;
      }
    }
    const firstClaudeMarketplacePlugin = claudeMarketplace.plugins?.[0];
    const currentPluginVersion = firstClaudeMarketplacePlugin?.version;
    if (currentPluginVersion !== version) {
      drifted.push({ file: claudeMarketplacePath, field: 'plugins[0].version', current: currentPluginVersion });
      if (!checkOnly && firstClaudeMarketplacePlugin) {
        firstClaudeMarketplacePlugin.version = version;
        changed = true;
      }
    }
    const currentHomepage = firstClaudeMarketplacePlugin?.metadata?.homepage;
    if (currentHomepage !== homepageUrl) {
      drifted.push({ file: claudeMarketplacePath, field: 'plugins[0].metadata.homepage', current: currentHomepage });
      if (!checkOnly && firstClaudeMarketplacePlugin) {
        firstClaudeMarketplacePlugin.metadata = firstClaudeMarketplacePlugin.metadata || {};
        firstClaudeMarketplacePlugin.metadata.homepage = homepageUrl;
        changed = true;
      }
    }
    if (!checkOnly && changed) {
      writeJson(claudeMarketplacePath, claudeMarketplace);
    }
    targets.push(claudeMarketplacePath);
  }

  // 6. root Cursor marketplace manifest
  const cursorMarketplacePath = '.cursor-plugin/marketplace.json';
  if (fs.existsSync(path.join(PROJECT_ROOT, cursorMarketplacePath))) {
    const cursorMarketplace = readJson(cursorMarketplacePath);
    const current = cursorMarketplace.metadata && cursorMarketplace.metadata.version;
    if (current !== version) {
      drifted.push({ file: cursorMarketplacePath, field: 'metadata.version', current });
      if (!checkOnly) {
        cursorMarketplace.metadata = cursorMarketplace.metadata || {};
        cursorMarketplace.metadata.version = version;
        writeJson(cursorMarketplacePath, cursorMarketplace);
      }
    }
    targets.push(cursorMarketplacePath);
  }

  // 7. plugin Cursor manifest
  const cursorPluginManifestPath = 'plugins/cursor-marketplace/.cursor-plugin/plugin.json';
  if (fs.existsSync(path.join(PROJECT_ROOT, cursorPluginManifestPath))) {
    const cursorPlugin = readJson(cursorPluginManifestPath);
    cursorPlugin.__file = cursorPluginManifestPath;
    const changed = [
      syncJsonField(cursorPlugin, 'version', version, drifted, checkOnly),
      syncJsonField(cursorPlugin, 'homepage', homepageUrl, drifted, checkOnly),
      syncJsonField(cursorPlugin, 'repository', repositoryUrl, drifted, checkOnly),
    ].some(Boolean);
    delete cursorPlugin.__file;
    if (!checkOnly && changed) {
      writeJson(cursorPluginManifestPath, cursorPlugin);
    }
    targets.push(cursorPluginManifestPath);
  }

  // 8. Codex plugin manifest + MCP config
  const codexAdapterConfigPath = 'adapters/codex/config.toml';
  if (fs.existsSync(path.join(PROJECT_ROOT, codexAdapterConfigPath))) {
    const content = fs.readFileSync(path.join(PROJECT_ROOT, codexAdapterConfigPath), 'utf8');
    const updated = content.replace(/thumbgate@(\d+\.\d+\.\d+)/g, `thumbgate@${version}`);
    if (updated !== content) {
      drifted.push({ file: codexAdapterConfigPath, field: 'package-version-string', current: content.match(/thumbgate@\d+\.\d+\.\d+/g)?.join(', ') || null });
      if (!checkOnly) {
        fs.writeFileSync(path.join(PROJECT_ROOT, codexAdapterConfigPath), updated);
      }
    }
    targets.push(codexAdapterConfigPath);
  }

  const codexPluginManifestPath = 'plugins/codex-profile/.codex-plugin/plugin.json';
  if (fs.existsSync(path.join(PROJECT_ROOT, codexPluginManifestPath))) {
    const codexPlugin = readJson(codexPluginManifestPath);
    codexPlugin.__file = codexPluginManifestPath;
    const changed = [
      syncJsonField(codexPlugin, 'version', version, drifted, checkOnly),
      syncJsonField(codexPlugin, 'homepage', homepageUrl, drifted, checkOnly),
      syncJsonField(codexPlugin, 'repository', repositoryUrl, drifted, checkOnly),
    ].some(Boolean);
    delete codexPlugin.__file;
    if (!checkOnly && changed) {
      writeJson(codexPluginManifestPath, codexPlugin);
    }
    targets.push(codexPluginManifestPath);
  }

  const codexPluginConfigPath = 'plugins/codex-profile/.mcp.json';
  if (fs.existsSync(path.join(PROJECT_ROOT, codexPluginConfigPath))) {
    const codexPluginConfig = readJson(codexPluginConfigPath);
    const server = codexPluginConfig.mcpServers && codexPluginConfig.mcpServers.thumbgate;
    const expectedArgs = explicitPinnedServeArgs(version);
    const currentArgs = server && Array.isArray(server.args) ? server.args : [];
    if (server && server.command === 'npx' && JSON.stringify(currentArgs) !== JSON.stringify(expectedArgs)) {
      drifted.push({ file: codexPluginConfigPath, field: 'mcpServers.thumbgate.args', current: JSON.stringify(currentArgs) });
      if (!checkOnly) {
        server.args = expectedArgs.slice();
        writeJson(codexPluginConfigPath, codexPluginConfig);
      }
    }
    targets.push(codexPluginConfigPath);
  }

  const claudeCodexBridgeManifestPath = 'plugins/claude-codex-bridge/.claude-plugin/plugin.json';
  if (fs.existsSync(path.join(PROJECT_ROOT, claudeCodexBridgeManifestPath))) {
    const bridgePlugin = readJson(claudeCodexBridgeManifestPath);
    bridgePlugin.__file = claudeCodexBridgeManifestPath;
    const changed = [
      syncJsonField(bridgePlugin, 'version', version, drifted, checkOnly),
      syncJsonField(bridgePlugin, 'homepage', homepageUrl, drifted, checkOnly),
      syncJsonField(bridgePlugin, 'repository', repositoryUrl, drifted, checkOnly),
    ].some(Boolean);
    delete bridgePlugin.__file;
    if (!checkOnly && changed) {
      writeJson(claudeCodexBridgeManifestPath, bridgePlugin);
    }
    targets.push(claudeCodexBridgeManifestPath);
  }

  const claudeCodexBridgeConfigPath = 'plugins/claude-codex-bridge/.mcp.json';
  if (fs.existsSync(path.join(PROJECT_ROOT, claudeCodexBridgeConfigPath))) {
    const bridgeConfig = readJson(claudeCodexBridgeConfigPath);
    const server = bridgeConfig.mcpServers && bridgeConfig.mcpServers.thumbgate;
    const expectedArgs = explicitPinnedServeArgs(version);
    const currentArgs = server && Array.isArray(server.args) ? server.args : [];
    if (server && server.command === 'npx' && JSON.stringify(currentArgs) !== JSON.stringify(expectedArgs)) {
      drifted.push({ file: claudeCodexBridgeConfigPath, field: 'mcpServers.thumbgate.args', current: JSON.stringify(currentArgs) });
      if (!checkOnly) {
        server.args = expectedArgs.slice();
        writeJson(claudeCodexBridgeConfigPath, bridgeConfig);
      }
    }
    targets.push(claudeCodexBridgeConfigPath);
  }

  // 9. plugin Cursor MCP config
  const cursorPluginConfigPath = 'plugins/cursor-marketplace/mcp.json';
  if (fs.existsSync(path.join(PROJECT_ROOT, cursorPluginConfigPath))) {
    const cursorPluginConfig = readJson(cursorPluginConfigPath);
    const server = cursorPluginConfig.mcpServers && cursorPluginConfig.mcpServers.thumbgate;
    const expectedArgs = explicitLatestServeArgs();
    const currentArgs = server && Array.isArray(server.args) ? server.args : [];
    if (server && server.command === 'npx' && JSON.stringify(currentArgs) !== JSON.stringify(expectedArgs)) {
      drifted.push({ file: cursorPluginConfigPath, field: 'mcpServers.thumbgate.args', current: JSON.stringify(currentArgs) });
      if (!checkOnly) {
        server.args = expectedArgs.slice();
        writeJson(cursorPluginConfigPath, cursorPluginConfig);
      }
    }
    targets.push(cursorPluginConfigPath);
  }

  // 10. docs/install files that pin the npm package version
  const pinnedPackageTargets = [
    'adapters/claude/.mcp.json',
    'adapters/claw/config.toml',
    'adapters/claw/opencode.json',
    // The .mcp.json pins for claw/hermes/perplexity were missing from this list
    // while their config.toml and opencode.json siblings were present, so a
    // version bump left them pinned to the previous release. Users of those
    // harnesses would npx a stale package — 1.30.0 shipped auto-promoted gates
    // that could never match a command, so this was not a cosmetic drift.
    // tests/adapter-version-pins.test.js fails the release if it recurs.
    'adapters/claw/.mcp.json',
    'adapters/forge/forge.yaml',
    'adapters/hermes/config.toml',
    'adapters/hermes/opencode.json',
    'adapters/hermes/.mcp.json',
    'adapters/perplexity/config.toml',
    'adapters/perplexity/opencode.json',
    'adapters/perplexity/.mcp.json',
    'docs/PLUGIN_DISTRIBUTION.md',
    'adapters/README.md',
    'adapters/opencode/opencode.json',
    'docs/guides/opencode-integration.md',
    'docs/mcp-hub-submission.md',
    // VERIFICATION_EVIDENCE.md is an append-only historical record. Rewriting
    // old package receipts would pair a new version with an old integrity hash.
    'plugins/claude-codex-bridge/README.md',
    'plugins/claude-codex-bridge/INSTALL.md',
    'plugins/codex-profile/README.md',
    'plugins/codex-profile/INSTALL.md',
    'plugins/opencode-profile/INSTALL.md',
  ];
  const pinnedPackagePattern = new RegExp(`thumbgate@${VERSION_PATTERN}`, 'g');
  for (const relPath of pinnedPackageTargets) {
    const filePath = path.join(PROJECT_ROOT, relPath);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    const matches = content.match(pinnedPackagePattern) || [];
    const hasDrift = matches.some((match) => match !== `thumbgate@${version}`);
    if (hasDrift) {
      drifted.push({ file: relPath, field: 'package-version-string', current: matches.join(', ') });
      if (!checkOnly) {
        fs.writeFileSync(filePath, content.replace(pinnedPackagePattern, `thumbgate@${version}`));
      }
    }
    targets.push(relPath);
  }

  // 11. docs/landing-page.html — hero badge + JSON snippet
  const landingPath = 'docs/landing-page.html';
  if (fs.existsSync(path.join(PROJECT_ROOT, landingPath))) {
    const landingContent = fs.readFileSync(path.join(PROJECT_ROOT, landingPath), 'utf-8');
    // Match any version pattern in the hero badge
    const badgeMatch = landingContent.match(new RegExp(`v(${VERSION_PATTERN}) — Hosted API`));
    if (badgeMatch && badgeMatch[1] !== version) {
      drifted.push({ file: landingPath, field: 'hero-badge', current: badgeMatch[1] });
      if (!checkOnly) {
        replaceInFile(landingPath, `v${badgeMatch[1]} — Hosted API`, `v${version} — Hosted API`);
      }
    }
    // JSON snippet version
    const jsonMatch = landingContent.match(new RegExp(`"version"<\\/span><span class="out">: <\\/span><span class="val">"(${VERSION_PATTERN})"`));
    if (jsonMatch && jsonMatch[1] !== version) {
      drifted.push({ file: landingPath, field: 'json-snippet', current: jsonMatch[1] });
      if (!checkOnly) {
        replaceInFile(landingPath, `"${jsonMatch[1]}"</div>`, `"${version}"</div>`);
      }
    }
    targets.push(landingPath);
  }

  // 12. docs/mcp-hub-submission.md
  const mcpSubmPath = 'docs/mcp-hub-submission.md';
  if (fs.existsSync(path.join(PROJECT_ROOT, mcpSubmPath))) {
    const mcpContent = fs.readFileSync(path.join(PROJECT_ROOT, mcpSubmPath), 'utf-8');
    const versionMatch = mcpContent.match(new RegExp(`## Version\\s+(${VERSION_PATTERN})`));
    if (versionMatch && versionMatch[1] !== version) {
      drifted.push({ file: mcpSubmPath, field: 'version-heading', current: versionMatch[1] });
      if (!checkOnly) {
        replaceInFile(mcpSubmPath, versionMatch[1], version);
      }
    }
    targets.push(mcpSubmPath);
  }

  // 13. public/index.html — static landing proof/version markers + footer version
  const publicIndexPath = 'public/index.html';
  if (fs.existsSync(path.join(PROJECT_ROOT, publicIndexPath))) {
    const publicIndexFile = path.join(PROJECT_ROOT, publicIndexPath);
    let publicContent = fs.readFileSync(publicIndexFile, 'utf-8');
    let publicContentChanged = false;
    const heroMetaVersionPattern = new RegExp(`<meta name="thumbgate-version" content="(${VERSION_PATTERN})">`);
    const heroReleaseNotePattern = new RegExp(`New in v(${VERSION_PATTERN}):?`);
    const heroVersionMatch = heroMetaVersionPattern.exec(publicContent) || heroReleaseNotePattern.exec(publicContent);
    if (heroVersionMatch && heroVersionMatch[1] !== version) {
      drifted.push({ file: publicIndexPath, field: 'hero-release-note', current: heroVersionMatch[1] });
      if (!checkOnly) {
        publicContent = publicContent
          .replace(new RegExp(`<meta name="thumbgate-version" content="${VERSION_PATTERN}">`), `<meta name="thumbgate-version" content="${version}">`)
          .replace(new RegExp(`New in v${VERSION_PATTERN}:?`), `New in v${version}`);
        publicContentChanged = true;
      }
    }

    const proofMatch = new RegExp(`Versioned proof: v(${VERSION_PATTERN})`).exec(publicContent);
    if (proofMatch && proofMatch[1] !== version) {
      drifted.push({ file: publicIndexPath, field: 'proof-pill', current: proofMatch[1] });
      if (!checkOnly) {
        publicContent = publicContent.replace(`Versioned proof: v${proofMatch[1]}`, `Versioned proof: v${version}`);
        publicContentChanged = true;
      }
    }

    const footerMatch = new RegExp(`(?:Context Gateway|MIT License) [•·] (?:npm )?v(${VERSION_PATTERN})`).exec(publicContent);
    if (footerMatch && footerMatch[1] !== version) {
      drifted.push({ file: publicIndexPath, field: 'footer-version', current: footerMatch[1] });
      if (!checkOnly) {
        publicContent = publicContent.replace(
          new RegExp(`((?:Context Gateway|MIT License) [•·] (?:npm )?)v${VERSION_PATTERN}`),
          `$1v${version}`
        );
        publicContentChanged = true;
      }
    }
    if (publicContentChanged) {
      fs.writeFileSync(publicIndexFile, publicContent);
    }
    targets.push(publicIndexPath);
  }

  // 14. public/numbers.html — generated proof snapshot version markers
  const publicNumbersPath = 'public/numbers.html';
  if (fs.existsSync(path.join(PROJECT_ROOT, publicNumbersPath))) {
    const publicNumbersFile = path.join(PROJECT_ROOT, publicNumbersPath);
    let numbersContent = fs.readFileSync(publicNumbersFile, 'utf-8');
    let numbersContentChanged = false;

    const softwareVersionMatch = numbersContent.match(new RegExp(`"softwareVersion":\\s*"(${VERSION_PATTERN})"`));
    if (softwareVersionMatch && softwareVersionMatch[1] !== version) {
      drifted.push({ file: publicNumbersPath, field: 'softwareVersion', current: softwareVersionMatch[1] });
      if (!checkOnly) {
        numbersContent = numbersContent.replace(
          new RegExp(`"softwareVersion":\\s*"${VERSION_PATTERN}"`),
          `"softwareVersion": "${version}"`
        );
        numbersContentChanged = true;
      }
    }

    const freshnessVersionMatch = numbersContent.match(new RegExp(`Updated:\\s*\\d{4}-\\d{2}-\\d{2}\\s*·\\s*Version\\s+(${VERSION_PATTERN})`));
    if (freshnessVersionMatch && freshnessVersionMatch[1] !== version) {
      drifted.push({ file: publicNumbersPath, field: 'freshness-version', current: freshnessVersionMatch[1] });
      if (!checkOnly) {
        numbersContent = numbersContent.replace(
          new RegExp(`(Updated:\\s*\\d{4}-\\d{2}-\\d{2}\\s*·\\s*Version\\s+)${VERSION_PATTERN}`),
          `$1${version}`
        );
        numbersContentChanged = true;
      }
    }

    if (numbersContentChanged) {
      fs.writeFileSync(publicNumbersFile, numbersContent);
    }
    targets.push(publicNumbersPath);
  }

  // 15. adapters/mcp/server-stdio.js — MCP server metadata
  const serverStdioPath = 'adapters/mcp/server-stdio.js';
  const serverStdioFile = path.join(PROJECT_ROOT, serverStdioPath);
  if (fs.existsSync(serverStdioFile)) {
    const serverStdioContent = fs.readFileSync(serverStdioFile, 'utf-8');
    const serverInfoMatch = serverStdioContent.match(new RegExp(`version:\\s*'(${VERSION_PATTERN})'`));
    if (serverInfoMatch && serverInfoMatch[1] !== version) {
      drifted.push({ file: serverStdioPath, field: 'server-info-version', current: serverInfoMatch[1] });
      if (!checkOnly) {
        fs.writeFileSync(
          serverStdioFile,
          serverStdioContent.replace(new RegExp(`version:\\s*'${VERSION_PATTERN}'`), `version: '${version}'`)
        );
      }
    }
    targets.push(serverStdioPath);
  }

  // 16. mcpize.yaml
  const mcpizePath = 'mcpize.yaml';
  const mcpizeFile = path.join(PROJECT_ROOT, mcpizePath);
  if (fs.existsSync(mcpizeFile)) {
    const mcpizeContent = fs.readFileSync(mcpizeFile, 'utf-8');
    const mcpizeVersionRegex = /^version:\s*"[^"]+"/m;
    const mcpizeExpected = `version: "${version}"`;
    if (!mcpizeContent.includes(mcpizeExpected)) {
      drifted.push({ file: mcpizePath, field: 'version', current: mcpizeContent.match(/version:\s*"([^"]+)"/)?.[1] || 'unknown' });
      if (!checkOnly) {
        fs.writeFileSync(mcpizeFile, mcpizeContent.replace(mcpizeVersionRegex, mcpizeExpected));
      }
    }
    targets.push(mcpizePath);
  }


  // 17. plugins/vscode-extension/package.json
  const vscodeExtensionPath = "plugins/vscode-extension/package.json";
  if (fs.existsSync(path.join(PROJECT_ROOT, vscodeExtensionPath))) {
    const vscodeExt = readJson(vscodeExtensionPath);
    vscodeExt.__file = vscodeExtensionPath;
    const changed = [
      syncJsonField(vscodeExt, "version", version, drifted, checkOnly),
    ].some(Boolean);
    delete vscodeExt.__file;
    if (!checkOnly && changed) {
      writeJson(vscodeExtensionPath, vscodeExt);
    }
    targets.push(vscodeExtensionPath);
  }

  // Post-sync generators: targets whose content embeds the version but isn't a
  // simple string replacement — they have their own generator. Run AFTER the
  // simple sync so the package.json is at the new version when the generator
  // reads it. Each entry is { script, label } that gets `node <script>` invoked.
  // Failures are logged but never fail the version sync — they're picked up by
  // the per-generator test (e.g. tests/codex-marketplace-revenue-pack.test.js).
  const POST_SYNC_GENERATORS = [
    { script: 'scripts/codex-marketplace-revenue-pack.js', args: ['--write-docs'], label: 'codex marketplace pack' },
  ];
  const generatorResults = [];
  if (!checkOnly) {
    const { execFileSync } = require('node:child_process');
    for (const gen of POST_SYNC_GENERATORS) {
      const scriptPath = path.join(PROJECT_ROOT, gen.script);
      if (!fs.existsSync(scriptPath)) continue;
      try {
        execFileSync(process.execPath, [scriptPath, ...gen.args], {
          cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'],
        });
        generatorResults.push({ label: gen.label, ok: true });
      } catch (err) {
        // Surface as a warning, not a failure — the per-generator test catches drift.
        generatorResults.push({ label: gen.label, ok: false, error: String(err?.message || err).slice(0, 200) });
      }
    }
  }

  return {
    version,
    targets,
    drifted,
    generators: generatorResults,
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
  (result.generators || []).forEach((g) => {
    if (g.ok) console.log(`  ✔ regenerated: ${g.label}`);
    else console.warn(`  ✗ generator failed: ${g.label} — ${g.error}`);
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { syncVersion };
