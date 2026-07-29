'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  extractMetricsFromHtml,
  normalizeMetrics,
  metricsEqual,
  refreshCheck,
  refreshWrite,
  parseArgs,
} = require('../scripts/refresh-proof-pack');

describe('refresh-proof-pack helpers', () => {
  it('parseArgs defaults to write mode', () => {
    assert.equal(parseArgs([]).write, true);
    assert.equal(parseArgs(['--check']).check, true);
    assert.equal(parseArgs(['--min-score=95']).minScore, 95);
  });

  it('extractMetricsFromHtml reads JSON-LD variableMeasured', () => {
    const html = `<!doctype html><script type="application/ld+json">${JSON.stringify({
      '@type': 'Dataset',
      variableMeasured: [
        { name: 'score', value: 100 },
        { name: 'unsafeActionRate', value: 0 },
        { name: 'taskSuccessRate', value: 1 },
      ],
    })}</script>
    <p>Overall: <span class="good">PASSED</span> · composite score <strong>100</strong></p>`;
    const metrics = extractMetricsFromHtml(html);
    assert.equal(metrics.score, 100);
    assert.equal(metrics.unsafeActionRate, 0);
    assert.equal(metrics.taskSuccessRate, 1);
    assert.equal(metrics.passedLabel, 'PASSED');
  });

  it('metricsEqual ignores date-only drift and reports metric drift', () => {
    const a = { score: 100, unsafeActionRate: 0, taskSuccessRate: 1 };
    const b = { score: 100, unsafeActionRate: 0, taskSuccessRate: 1 };
    assert.equal(metricsEqual(a, b).equal, true);
    const drift = metricsEqual(a, { ...b, score: 93 });
    assert.equal(drift.equal, false);
    assert.equal(drift.diffs[0].key, 'score');
  });

  it('normalizeMetrics rounds rates stably', () => {
    assert.deepEqual(
      normalizeMetrics({ taskSuccessRate: 0.99999, score: 100 }),
      { taskSuccessRate: 1, score: 100 },
    );
  });
});

describe('refresh-proof-pack write/check', () => {
  it('write emits html + json sidecar into a temp dir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-proof-pack-'));
    const htmlPath = path.join(tmp, 'eval-scorecard.html');
    const sidecarPath = path.join(tmp, 'eval-scorecard.json');
    const result = refreshWrite({
      now: new Date('2026-07-29T12:00:00.000Z'),
      outputPath: htmlPath,
      sidecarPath,
      version: '1.99.0',
    });
    assert.equal(result.mode, 'write');
    assert.ok(fs.existsSync(htmlPath));
    assert.ok(fs.existsSync(sidecarPath));
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    assert.equal(sidecar.version, '1.99.0');
    assert.equal(sidecar.metrics.unsafeActionRate, 0);
    assert.ok(Number(sidecar.metrics.score) >= 90);
    assert.match(fs.readFileSync(htmlPath, 'utf8'), /Eval scorecard/i);
  });

  it('check passes when committed metrics match a provided fresh report', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      variableMeasured: [
        { name: 'score', value: 100 },
        { name: 'taskSuccessRate', value: 1 },
        { name: 'unsafeActionRate', value: 0 },
        { name: 'blockedUnsafeRate', value: 1 },
        { name: 'capabilityRate', value: 1 },
        { name: 'falseBlockRate', value: 0 },
        { name: 'replayStability', value: 1 },
      ],
    })}</script>`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-proof-check-'));
    const htmlPath = path.join(tmp, 'eval-scorecard.html');
    fs.writeFileSync(htmlPath, html);
    const result = refreshCheck({
      htmlPath,
      minScore: 90,
      report: {
        passed: true,
        metrics: {
          score: 100,
          taskSuccessRate: 1,
          unsafeActionRate: 0,
          blockedUnsafeRate: 1,
          capabilityRate: 1,
          falseBlockRate: 0,
          replayStability: 1,
        },
      },
    });
    assert.equal(result.passed, true);
    assert.equal(result.metricsMatch, true);
  });

  it('check fails on metric drift', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      variableMeasured: [
        { name: 'score', value: 100 },
        { name: 'unsafeActionRate', value: 0 },
      ],
    })}</script>`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-proof-drift-'));
    const htmlPath = path.join(tmp, 'eval-scorecard.html');
    fs.writeFileSync(htmlPath, html);
    const result = refreshCheck({
      htmlPath,
      minScore: 90,
      report: {
        passed: true,
        metrics: { score: 93, unsafeActionRate: 0 },
      },
    });
    assert.equal(result.passed, false);
    assert.equal(result.metricsMatch, false);
  });
});
