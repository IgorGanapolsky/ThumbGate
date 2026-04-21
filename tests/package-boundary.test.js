const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');

function npmPackManifest() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const manifest = JSON.parse(output)[0];
  return {
    fileCount: manifest.files.length,
    unpackedSize: manifest.unpackedSize,
    files: manifest.files.map((file) => file.path),
  };
}

function npmPackFiles() {
  return npmPackManifest().files;
}

function resolveRelativeRequire(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const basePath = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    basePath,
    `${basePath}.js`,
    path.join(basePath, 'index.js'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function collectStaticRuntimeDependencies(entryFile, packagedFiles) {
  const packaged = new Set(packagedFiles);
  const seen = new Set();
  const missing = new Set();

  function toPackagePath(filePath) {
    return path.relative(root, filePath).split(path.sep).join('/');
  }

  function visit(filePath) {
    const packagePath = toPackagePath(filePath);
    if (seen.has(packagePath)) return;
    seen.add(packagePath);

    const source = fs.readFileSync(filePath, 'utf8');
    const requirePattern = /require\(['"](\.{1,2}\/[^'"]+)['"]\)/g;
    let match;
    while ((match = requirePattern.exec(source)) !== null) {
      const resolved = resolveRelativeRequire(filePath, match[1]);
      if (!resolved || !resolved.startsWith(root)) continue;

      const dependencyPath = toPackagePath(resolved);
      if (!packaged.has(dependencyPath)) {
        missing.add(`${packagePath} -> ${dependencyPath}`);
        continue;
      }
      visit(resolved);
    }
  }

  visit(path.join(root, entryFile));
  return [...missing].sort();
}

test('npm package excludes generated runtime state from included directories', () => {
  const runtimeDb = path.join(root, 'scripts', 'social-analytics', 'db', 'package-leak-test.sqlite');
  const pycacheDir = path.join(root, 'scripts', '__pycache__');
  const pycacheFile = path.join(pycacheDir, 'package_leak_test.cpython-314.pyc');

  fs.mkdirSync(path.dirname(runtimeDb), { recursive: true });
  fs.mkdirSync(pycacheDir, { recursive: true });
  fs.writeFileSync(runtimeDb, 'local sqlite state must not ship\n');
  fs.writeFileSync(pycacheFile, 'compiled bytecode must not ship\n');

  try {
    const files = npmPackFiles();
    assert.equal(files.includes('scripts/social-analytics/db/package-leak-test.sqlite'), false);
    assert.equal(files.includes('scripts/__pycache__/package_leak_test.cpython-314.pyc'), false);
  } finally {
    fs.rmSync(runtimeDb, { force: true });
    fs.rmSync(pycacheFile, { force: true });
    try {
      fs.rmdirSync(pycacheDir);
    } catch {
      // Keep the directory if a developer has other local bytecode files.
    }
  }
});

test('npm package ships static dependencies needed for MCP server startup', () => {
  const files = npmPackFiles();
  const missing = collectStaticRuntimeDependencies('adapters/mcp/server-stdio.js', files);

  assert.deepEqual(missing, []);
});

test('npm package ships a slim runtime boundary instead of repo/dev surfaces', () => {
  const manifest = npmPackManifest();
  const files = manifest.files;
  const requiredRuntimeFiles = [
    'src/index.js',
    'src/api/server.js',
    'bin/cli.js',
    'bin/postinstall.js',
    'adapters/mcp/server-stdio.js',
    'scripts/bot-detection.js',
    'scripts/feedback-loop.js',
    'scripts/gates-engine.js',
    'scripts/hf-papers.js',
    'scripts/session-report.js',
    'scripts/statusline.sh',
    'scripts/statusline-meta.js',
    'scripts/swarm-coordinator.js',
    'scripts/tool-registry.js',
    'skills/thumbgate/SKILL.md',
    '.claude-plugin/plugin.json',
    'README.md',
    'LICENSE',
  ];
  // public/ HTML files referenced by server.js MUST ship — the server reads them at
  // runtime via LESSONS_PAGE_PATH etc. Excluding them causes the lessons UI to degrade
  // to the stripped-down "packaged runtime" fallback.
  const requiredPublicFiles = [
    'public/lessons.html',
    'public/index.html',
  ];
  const forbiddenPrefixes = [
    'public/js/',
    'public/learn/',
    'public/guides/',
    'public/compare/',
    'plugins/',
    '.claude-plugin/bundle/',
    'scripts/social-analytics/',
    'scripts/content-engine/',
  ];
  const forbiddenFiles = [
    'bin/memory.sh',
    'bin/obsidian-sync.sh',
    'scripts/post-to-x.js',
    'scripts/post-to-x-retry.sh',
    'scripts/reddit-dm-outreach.js',
    'scripts/reddit-monitor-cron.sh',
    'scripts/perplexity-command-center.js',
    'scripts/perplexity-marketing.js',
    'scripts/build-claude-mcpb.js',
    'scripts/build-codex-plugin.js',
  ];

  // File-count ceiling bumped 220 → 225 (2026-04-19) after main picked up
  // the autonomous control-plane runner (#956) and progressive-discovery
  // MCP tool (#960), plus this branch's scripts/bayes-optimal-gate.js —
  // combined net of +4 runtime script files shipped to the tarball.
  // Bumped 225 → 230 (2026-04-20) because the MCP server imports these files
  // at startup or through required startup modules. Omitting them crashes
  // published `thumbgate serve` with a closed MCP transport.
  // Bumped 230 → 232 (2026-04-20) to ship the read-only operator artifact
  // generator and its PR pulse dependency for published MCP/CLI runtimes.
  // Bumped 232 → 233 (2026-04-20) to ship scripts/rule-validator.js, the
  // Autogenesis-inspired pre-promotion validator that feedback-loop.js
  // requires at captureFeedback time before writing synthesized-rules.jsonl.
  assert.ok(
    manifest.fileCount <= 233,
    `npm package should stay <= 233 files, got ${manifest.fileCount}`
  );
  // Ceiling bumped from 2.75 MB → 2.85 MB (2026-04-16) to accommodate the
  // incremental review-delta demo content in public/dashboard.html landing
  // inline with main's token-savings dashboard additions.
  // Bumped 2.85 MB → 2.90 MB (2026-04-18) to accommodate
  // buildRecentCorrectiveActionsContext in gates-engine.js + its tests.
  // Bumped 2.90 MB → 2.95 MB (2026-04-19) to accommodate the Bayes-optimal
  // gate runtime (scripts/bayes-optimal-gate.js, ~8 KB) which gate-stats.js
  // requires at runtime, plus the config/enforcement.json loss-matrix shipped
  // alongside it. Still well below the ~3 MB drift threshold where we'd need
  // to actively trim assets.
  // Bumped 2.95 MB → 2.97 MB (2026-04-20) for operator-artifacts.js plus the
  // existing PR manager it composes for the read-only PR pulse.
  // Bumped 2.97 MB → 3.00 MB (2026-04-20) after this branch rebased onto #1105's
  // hard-block destructive local actions gate (gates-engine.js expansion + new
  // test fixtures shipped via the runtime surface), pushing unpackedSize to
  // 2,970,865 — 865 B above the previous ceiling. 30 KB headroom to avoid
  // rebase-flapping on the next main merge.
  assert.ok(
    manifest.unpackedSize <= 3_000_000,
    `npm package should stay <= 3.00 MB unpacked, got ${manifest.unpackedSize}`
  );

  for (const file of requiredRuntimeFiles) {
    assert.ok(files.includes(file), `required runtime file must ship: ${file}`);
  }
  for (const file of requiredPublicFiles) {
    assert.ok(files.includes(file), `required public HTML must ship (server.js reads it at runtime): ${file}`);
  }
  for (const prefix of forbiddenPrefixes) {
    assert.equal(files.some((file) => file.startsWith(prefix)), false, `must not ship ${prefix}`);
  }
  for (const file of forbiddenFiles) {
    assert.equal(files.includes(file), false, `must not ship dev/marketing file: ${file}`);
  }
});

test('package main resolves through src entrypoint', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.equal(pkg.main, 'src/index.js');
  assert.equal(fs.existsSync(path.join(root, pkg.main)), true);
});
