'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const setup = require('../scripts/graphify-setup');
const readiness = require('../scripts/graphify-readiness');
const { assess, parseArgs, summarizeGraph, readVersion } = readiness;
const {
  checkGraphStaleness,
  formatAge,
  resolveGitBinary,
} = require('../scripts/graphify-staleness-check');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphify-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('graphify readiness rail', () => {
  it('pins Graphify-Labs package identity (graphifyy, not a clone)', () => {
    assert.match(setup.PACKAGE, /^graphifyy>=/);
    assert.equal(setup.versionAtLeast('0.9.53', setup.MIN_VERSION), true);
    assert.equal(setup.versionAtLeast('0.9.0', setup.MIN_VERSION), false);
  });

  it('documents .graphifyignore and code-search agent doc', () => {
    assert.equal(fs.existsSync(path.join(REPO, '.graphifyignore')), true);
    const doc = fs.readFileSync(path.join(REPO, 'docs/agents/code-search.md'), 'utf8');
    assert.match(doc, /Graphify-Labs\/graphify/);
    assert.match(doc, /graphifyy/);
    assert.doesNotMatch(doc, /vector store as primary/i);
  });

  it('skill reference docs pass user values via env/argv (no python -c interpolation)', () => {
    const refs = [
      '.agents/skills/graphify/references/add-watch.md',
      '.agents/skills/graphify/references/query.md',
      '.agents/skills/graphify/references/update.md',
      '.hermes/skills/graphify/references/add-watch.md',
      '.hermes/skills/graphify/references/query.md',
      '.hermes/skills/graphify/references/update.md',
    ];
    for (const rel of refs) {
      const body = fs.readFileSync(path.join(REPO, rel), 'utf8');
      assert.doesNotMatch(body, /ingest\('URL'/);
      assert.doesNotMatch(body, /a_term = 'NODE_A'/);
      assert.doesNotMatch(body, /term = 'NODE_NAME'/);
      assert.doesNotMatch(body, /Path\('INPUT_PATH'\)/);
      assert.doesNotMatch(body, /root='INPUT_PATH'/);
    }
    const addWatch = fs.readFileSync(
      path.join(REPO, '.agents/skills/graphify/references/add-watch.md'),
      'utf8',
    );
    assert.match(addWatch, /GRAPHIFY_URL/);
    assert.match(addWatch, /os\.environ\['GRAPHIFY_URL'\]/);
    const query = fs.readFileSync(
      path.join(REPO, '.agents/skills/graphify/references/query.md'),
      'utf8',
    );
    assert.match(query, /a_term = sys\.argv\[1\]/);
    assert.match(query, /"\$NODE_A" "\$NODE_B"/);
  });

  it('assess() reports bin path and never claims vector retrieval', () => {
    const report = assess({ requireGraph: false });
    assert.equal(typeof report.ok, 'boolean');
    assert.match(report.bin, /\.graphify-venv[/\\]bin[/\\]graphify$/);
    assert.equal(report.honesty.vectorStore, false);
    assert.equal(report.honesty.notAClone, true);
    assert.match(report.honesty.product, /Graphify-Labs/);
  });

  it('assess() fail-closed on missing bin / requireGraph / parseError', () => {
    withTempDir((dir) => {
      const missing = assess({
        requireGraph: true,
        bin: path.join(dir, 'no-bin'),
        graphPath: path.join(dir, 'missing-graph.json'),
      });
      assert.equal(missing.ok, false);
      assert.ok(missing.reasons.some((r) => /missing \.graphify-venv/.test(r)));
      assert.ok(missing.reasons.some((r) => /missing graphify-out\/graph\.json/.test(r)));

      const badGraph = path.join(dir, 'graph.json');
      fs.writeFileSync(badGraph, '{not-json');
      const broken = assess({
        requireGraph: false,
        bin: path.join(dir, 'no-bin'),
        graphPath: badGraph,
      });
      assert.equal(broken.ok, false);
      assert.ok(broken.reasons.some((r) => /unreadable/.test(r)));
      assert.equal(broken.graph.exists, true);
      assert.ok(broken.graph.parseError);
    });
  });

  it('summarizeGraph counts edges when links are absent', () => {
    withTempDir((dir) => {
      const graphPath = path.join(dir, 'graph.json');
      fs.writeFileSync(graphPath, JSON.stringify({
        nodes: [{ id: 'a' }, { id: 'b' }],
        edges: [{ source: 'a', target: 'b' }],
      }));
      const summary = summarizeGraph(graphPath);
      assert.equal(summary.exists, true);
      assert.equal(summary.nodes, 2);
      assert.equal(summary.links, 1);
      assert.equal(summarizeGraph(path.join(dir, 'absent.json')).exists, false);
    });
  });

  it('readVersion returns empty for missing or non-version binaries', () => {
    assert.equal(readVersion(path.join(os.tmpdir(), 'no-such-graphify-bin')), '');
    withTempDir((dir) => {
      const fake = path.join(dir, 'graphify');
      fs.writeFileSync(fake, '#!/bin/sh\necho weird\n');
      fs.chmodSync(fake, 0o755);
      assert.equal(readVersion(fake), '');
    });
  });

  it('readiness parseArgs accepts --json / --require-graph / --help', () => {
    assert.deepEqual(parseArgs(['--json', '--require-graph']), {
      json: true,
      requireGraph: true,
      help: false,
    });
    assert.equal(parseArgs(['--help']).help, true);
    assert.throws(() => parseArgs(['--nope']), /Unknown argument/);
  });

  it('CLI --help exits 0 for readiness/setup/staleness', () => {
    for (const script of [
      'scripts/graphify-readiness.js',
      'scripts/graphify-setup.js',
      'scripts/graphify-staleness-check.js',
    ]) {
      const result = spawnSync(process.execPath, [path.join(REPO, script), '--help'], {
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.equal(result.status, 0, `${script} --help failed: ${result.stderr}`);
    }
  });

  it('staleness check returns a structured report', () => {
    const report = checkGraphStaleness();
    assert.equal(typeof report.exists, 'boolean');
    assert.equal(typeof report.stale, 'boolean');
    assert.equal(typeof report.graphifyAvailable, 'boolean');
  });

  it('staleness check marks missing and age-stale graphs', () => {
    withTempDir((dir) => {
      const missing = checkGraphStaleness({
        graphPath: path.join(dir, 'absent.json'),
        bin: path.join(dir, 'no-bin'),
      });
      assert.equal(missing.exists, false);
      assert.equal(missing.stale, true);
      assert.equal(missing.graphifyAvailable, false);

      const graphPath = path.join(dir, 'graph.json');
      fs.writeFileSync(graphPath, JSON.stringify({
        nodes: [{ id: 'n1' }],
        links: [],
      }));
      const old = Date.now() - (60 * 60 * 1000);
      fs.utimesSync(graphPath, old / 1000, old / 1000);
      const aged = checkGraphStaleness({
        graphPath,
        bin: path.join(dir, 'no-bin'),
        repo: REPO,
        nowMs: Date.now() + (STALE_HOURS_MS()),
      });
      assert.equal(aged.exists, true);
      assert.equal(aged.stale, true);
      assert.equal(aged.nodeCount, 1);
      assert.match(aged.ageDisplay, /d$|h$/);
    });
  });

  it('formatAge and resolveGitBinary are deterministic helpers', () => {
    assert.equal(formatAge(0.5), '30m');
    assert.match(formatAge(3), /3h/);
    assert.match(formatAge(48), /2d/);
    const gitBin = resolveGitBinary();
    assert.match(gitBin, /git$/);
    assert.equal(path.isAbsolute(gitBin), true);
  });

  it('versionAtLeast compares semver-ish triples', () => {
    assert.equal(setup.versionAtLeast('1.0.0', '1.0.0'), true);
    assert.equal(setup.versionAtLeast('1.2.3', '1.2.4'), false);
    assert.equal(setup.versionAtLeast('2.0.0', '1.9.9'), true);
  });

  it('parseArgs accepts --json and --skip-build', () => {
    assert.deepEqual(setup.parseArgs(['--json', '--skip-build']), {
      json: true,
      skipBuild: true,
      help: false,
    });
    assert.throws(() => setup.parseArgs(['--nope']), /Unknown argument/);
  });
});

function STALE_HOURS_MS() {
  return 49 * 60 * 60 * 1000;
}
