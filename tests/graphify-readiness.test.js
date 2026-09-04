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

  it('setup summarizeGraph / ensureVenv / ensurePackage / buildGraph with injectables', () => {
    withTempDir((dir) => {
      const graphPath = path.join(dir, 'graph.json');
      fs.writeFileSync(graphPath, JSON.stringify({
        nodes: [{ id: '1' }],
        edges: [{ source: '1', target: '1' }],
      }));
      const summary = setup.summarizeGraph(graphPath);
      assert.equal(summary.nodes, 1);
      assert.equal(summary.links, 1);

      const py = path.join(dir, 'python');
      fs.writeFileSync(py, '#!/bin/sh\n');
      assert.deepEqual(setup.ensureVenv({ py, venv: dir }), { created: false });

      const created = setup.ensureVenv({
        py: path.join(dir, 'missing-py'),
        venv: path.join(dir, 'venv'),
        runFn: () => ({ status: 0, stdout: '', stderr: '' }),
      });
      assert.deepEqual(created, { created: true });
      assert.throws(() => setup.ensureVenv({
        py: path.join(dir, 'missing-py-2'),
        venv: path.join(dir, 'venv2'),
        runFn: () => ({ status: 1, stdout: '', stderr: 'boom' }),
      }), /venv create failed/);

      const bin = path.join(dir, 'graphify');
      fs.writeFileSync(bin, '#!/bin/sh\n');
      const already = setup.ensurePackage({
        py,
        pip: path.join(dir, 'pip'),
        bin,
        runFn: () => ({ status: 0, stdout: '0.9.53\n', stderr: '' }),
      });
      assert.equal(already.installed, false);
      assert.equal(already.versionProbe, '0.9.53');

      const installed = setup.ensurePackage({
        py,
        pip: path.join(dir, 'pip'),
        bin: path.join(dir, 'will-create-bin'),
        runFn: (cmd, args) => {
          if (args[0] === 'install' && args.includes(setup.PACKAGE)) {
            fs.writeFileSync(path.join(dir, 'will-create-bin'), 'ok');
            return { status: 0, stdout: '', stderr: '' };
          }
          if (args[0] === '-c') return { status: 1, stdout: '', stderr: 'no module' };
          return { status: 0, stdout: '', stderr: '' };
        },
      });
      assert.equal(installed.installed, true);

      assert.equal(setup.graphifyVersion({
        bin,
        runFn: () => ({ status: 0, stdout: 'graphify 0.9.53\n', stderr: '' }),
      }), '0.9.53');
      assert.equal(setup.graphifyVersion({
        bin,
        runFn: () => ({ status: 1, stdout: '', stderr: 'nope' }),
      }), '');

      const built = setup.buildGraph({
        bin,
        graphPath,
        runFn: () => ({ status: 0, stdout: '', stderr: '' }),
      });
      assert.equal(built.nodes, 1);
      assert.throws(() => setup.buildGraph({
        bin,
        graphPath,
        runFn: () => ({ status: 2, stdout: '', stderr: 'fail' }),
      }), /graphify update failed/);
      assert.throws(() => setup.buildGraph({
        bin,
        graphPath: path.join(dir, 'absent.json'),
        runFn: () => ({ status: 0, stdout: '', stderr: '' }),
      }), /graph\.json is missing/);
    });
  });

  it('setupReport skip-build and failure paths', () => {
    withTempDir((dir) => {
      const bin = path.join(dir, 'graphify');
      const py = path.join(dir, 'python');
      fs.writeFileSync(bin, 'x');
      fs.writeFileSync(py, 'x');
      const graphPath = path.join(dir, 'graph.json');
      fs.writeFileSync(graphPath, JSON.stringify({ nodes: [], links: [] }));

      const okSkip = setup.setupReport(
        { json: false, skipBuild: true, help: false },
        {
          py,
          bin,
          pip: path.join(dir, 'pip'),
          venv: dir,
          graphPath,
          runFn: () => ({ status: 0, stdout: 'graphify 0.9.53\n', stderr: '' }),
        },
      );
      assert.equal(okSkip.ok, true);
      assert.equal(okSkip.steps.graph.skippedBuild, true);

      const missingGraph = setup.setupReport(
        { json: false, skipBuild: true, help: false },
        {
          py,
          bin,
          pip: path.join(dir, 'pip'),
          venv: dir,
          graphPath: path.join(dir, 'nope.json'),
          runFn: () => ({ status: 0, stdout: 'graphify 0.9.53\n', stderr: '' }),
        },
      );
      assert.equal(missingGraph.ok, true);
      assert.equal(missingGraph.steps.graph.exists, false);

      const lowVer = setup.setupReport(
        { json: false, skipBuild: true, help: false },
        {
          py,
          bin,
          pip: path.join(dir, 'pip'),
          venv: dir,
          graphPath,
          runFn: () => ({ status: 0, stdout: 'graphify 0.1.0\n', stderr: '' }),
        },
      );
      assert.equal(lowVer.ok, false);
      assert.match(lowVer.error, /below required/);
    });
  });

  it('setup main --help and --json --skip-build via injectables', () => {
    const help = setup.main(['--help'], { exit: false });
    assert.equal(help.status, 'HELP');

    withTempDir((dir) => {
      const bin = path.join(dir, 'graphify');
      const py = path.join(dir, 'python');
      fs.writeFileSync(bin, 'x');
      fs.writeFileSync(py, 'x');
      const graphPath = path.join(dir, 'graph.json');
      fs.writeFileSync(graphPath, JSON.stringify({ nodes: [{ id: 'n' }], links: [] }));
      const report = setup.main(['--json', '--skip-build'], {
        exit: false,
        py,
        bin,
        pip: path.join(dir, 'pip'),
        venv: dir,
        graphPath,
        runFn: () => ({ status: 0, stdout: 'graphify 0.9.53\n', stderr: '' }),
      });
      assert.equal(report.ok, true);
      assert.equal(report.version, '0.9.53');
    });
  });
});

function STALE_HOURS_MS() {
  return 49 * 60 * 60 * 1000;
}
