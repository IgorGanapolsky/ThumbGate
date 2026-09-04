'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const setup = require('../scripts/graphify-setup');
const { assess } = require('../scripts/graphify-readiness');
const { checkGraphStaleness } = require('../scripts/graphify-staleness-check');

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

  it('assess() reports bin path and never claims vector retrieval', () => {
    const report = assess({ requireGraph: false });
    assert.equal(typeof report.ok, 'boolean');
    assert.match(report.bin, /\.graphify-venv[/\\]bin[/\\]graphify$/);
    assert.equal(report.honesty.vectorStore, false);
    assert.equal(report.honesty.notAClone, true);
    assert.match(report.honesty.product, /Graphify-Labs/);
  });

  it('staleness check returns a structured report', () => {
    const report = checkGraphStaleness();
    assert.equal(typeof report.exists, 'boolean');
    assert.equal(typeof report.stale, 'boolean');
    assert.equal(typeof report.graphifyAvailable, 'boolean');
  });
  it('formatAge and resolveGitBinary are deterministic helpers', () => {
    const { formatAge, resolveGitBinary } = require('../scripts/graphify-staleness-check');
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
