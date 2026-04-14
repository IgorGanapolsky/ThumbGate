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

test('npm package ships a slim runtime boundary instead of repo/dev surfaces', () => {
  const manifest = npmPackManifest();
  const files = manifest.files;
  const requiredRuntimeFiles = [
    'src/index.js',
    'src/api/server.js',
    'bin/cli.js',
    'bin/postinstall.js',
    'adapters/mcp/server-stdio.js',
    'scripts/feedback-loop.js',
    'scripts/gates-engine.js',
    'scripts/statusline.sh',
    'scripts/statusline-meta.js',
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

  assert.ok(
    manifest.fileCount <= 220,
    `npm package should stay <= 220 files, got ${manifest.fileCount}`
  );
  assert.ok(
    manifest.unpackedSize <= 2_750_000,
    `npm package should stay <= 2.75 MB unpacked, got ${manifest.unpackedSize}`
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
