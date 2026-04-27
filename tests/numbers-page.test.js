'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const pkg = require('../package.json');

const {
  generate,
  renderNumbersPage,
} = require('../scripts/generate-numbers-page');

const FIXTURE_STATS = {
  totalGates: 42,
  manualGates: 12,
  autoPromotedGates: 30,
  blockGates: 25,
  warnGates: 17,
  totalBlocked: 180,
  totalWarned: 40,
  topBlocked: { id: 'never-force-push-main', occurrences: 23 },
  lastPromotion: {
    gateId: 'never-force-push-main',
    timestamp: '2026-04-18T12:00:00Z',
  },
  estimatedHoursSaved: '55.0',
  bayesErrorRate: 0.031,
  gates: [],
};

const FIXTURE_SAVINGS = {
  blockedCalls: 180,
  deflectedBots: 0,
  tokensSavedInput: 360000,
  tokensSavedOutput: 108000,
  tokensSavedTotal: 468000,
  dollarsSaved: 1.234,
  dollarsSavedDisplay: '$1.23',
  tokensSavedDisplay: '468K',
  blendedPricePer1M: { input: 3.57, output: 17.9 },
  modelMix: { 'claude-sonnet-4-5': 0.8 },
};

describe('generate-numbers-page renderer', () => {
  const html = renderNumbersPage({
    version: '1.12.2',
    nowIso: '2026-04-20T10:00:00.000Z',
    nowDate: '2026-04-20',
    gate: FIXTURE_STATS,
    savings: FIXTURE_SAVINGS,
  });

  it('emits a visible freshness marker with the generation date', () => {
    assert.ok(
      html.includes('Updated: 2026-04-20'),
      'expected visible "Updated: 2026-04-20" marker in the rendered HTML',
    );
  });

  it('emits a SoftwareApplication JSON-LD block with dateModified', () => {
    assert.ok(
      html.includes('"@type": "SoftwareApplication"'),
      'expected SoftwareApplication JSON-LD type',
    );
    assert.ok(
      html.includes('"dateModified": "2026-04-20"'),
      'expected JSON-LD dateModified equal to nowDate',
    );
  });

  it('emits a Dataset JSON-LD with variableMeasured entries for the headline numbers', () => {
    assert.ok(
      html.includes('"@type": "Dataset"'),
      'expected Dataset JSON-LD type',
    );
    assert.ok(
      html.includes('"name": "active_gates"'),
      'expected active_gates property in Dataset',
    );
    assert.ok(
      html.includes('"name": "actions_blocked"'),
      'expected actions_blocked property in Dataset',
    );
    assert.ok(
      html.includes('"name": "estimated_dollars_saved"'),
      'expected estimated_dollars_saved property in Dataset',
    );
    assert.ok(
      html.includes('"unitText": "USD"'),
      'expected USD unitText on the dollars PropertyValue',
    );
  });

  it('emits stable authorship Person schema with sameAs links', () => {
    assert.ok(
      html.includes('"@type": "Person"'),
      'expected Person schema',
    );
    assert.ok(
      html.includes('"name": "Igor Ganapolsky"'),
      'expected author name',
    );
    assert.ok(
      html.includes('"sameAs"'),
      'expected sameAs array for authorship',
    );
    // Anchor the profile URL inside a quoted JSON-LD value to avoid CodeQL
    // "incomplete URL substring sanitization" (js/incomplete-url-substring-sanitization).
    assert.match(
      html,
      /"https:\/\/github\.com\/IgorGanapolsky"/,
      'expected GitHub profile as a quoted JSON-LD value in sameAs',
    );
  });

  it('renders the primary stats with formatted numbers', () => {
    assert.ok(html.includes('42'), 'expected total gates value');
    assert.ok(html.includes('180'), 'expected blocked actions value');
    assert.ok(html.includes('$1.23'), 'expected dollars saved display');
    assert.ok(html.includes('468K'), 'expected tokens saved display');
    assert.ok(html.includes('3.1%'), 'expected bayes error rate display');
    assert.ok(
      html.includes('never-force-push-main'),
      'expected top blocked gate id',
    );
  });

  it('links each stat back to its source script so numbers are auditable', () => {
    assert.ok(
      html.includes('scripts/gate-stats.js'),
      'expected source link to gate-stats.js',
    );
    assert.ok(
      html.includes('scripts/token-savings.js'),
      'expected source link to token-savings.js',
    );
    assert.ok(
      html.includes('scripts/bayes-optimal-gate.js'),
      'expected source link to bayes-optimal-gate.js',
    );
  });

  it('escapes untrusted stat identifiers to prevent HTML injection', () => {
    const dangerous = renderNumbersPage({
      version: '1.0.0',
      nowIso: '2026-04-20T00:00:00.000Z',
      nowDate: '2026-04-20',
      gate: {
        ...FIXTURE_STATS,
        topBlocked: { id: '<script>alert(1)</script>', occurrences: 1 },
      },
      savings: FIXTURE_SAVINGS,
    });
    assert.ok(
      !dangerous.includes('<script>alert(1)</script>'),
      'raw <script> tag from topBlocked.id must be escaped',
    );
    assert.ok(
      dangerous.includes('&lt;script&gt;alert(1)&lt;/script&gt;'),
      'escaped script tag should appear in output',
    );
  });
});

describe('generate-numbers-page writer', () => {
  it('writes a file with SoftwareApplication JSON-LD when invoked with injected data', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-numbers-'));
    const outPath = path.join(tmpDir, 'numbers.html');
    try {
      const result = generate({
        version: '9.9.9',
        now: new Date('2026-04-20T00:00:00Z'),
        data: { gate: FIXTURE_STATS, savings: FIXTURE_SAVINGS },
        outPath,
      });
      assert.equal(result.outPath, outPath);
      assert.ok(result.bytes > 1000, 'expected a non-trivial HTML file');
      const contents = fs.readFileSync(outPath, 'utf8');
      assert.ok(contents.startsWith('<!DOCTYPE html>'));
      assert.ok(contents.includes('"softwareVersion": "9.9.9"'));
      assert.ok(contents.includes('Updated: 2026-04-20'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('public/numbers.html generated artifact', () => {
  const numbersPath = path.resolve(__dirname, '..', 'public', 'numbers.html');

  it('exists in the public directory (regenerate via npm run numbers:generate)', () => {
    assert.ok(
      fs.existsSync(numbersPath),
      'public/numbers.html is missing — run `npm run numbers:generate`',
    );
  });

  it('contains a visible "Updated:" marker and dateModified JSON-LD', () => {
    const contents = fs.readFileSync(numbersPath, 'utf8');
    assert.match(
      contents,
      /Updated:\s*<time datetime="\d{4}-\d{2}-\d{2}"|Updated:\s*\d{4}-\d{2}-\d{2}/,
      'expected a visible "Updated:" marker',
    );
    assert.match(
      contents,
      /"dateModified":\s*"\d{4}-\d{2}-\d{2}"/,
      'expected JSON-LD dateModified ISO date',
    );
  });

  it('stays synced to the current package version and snapshot wording', () => {
    const contents = fs.readFileSync(numbersPath, 'utf8');

    assert.match(
      contents,
      new RegExp(`"softwareVersion": "${pkg.version.replaceAll('.', '\\.')}"`),
      'expected public/numbers.html to match package.json version',
    );
    assert.match(contents, /First-Party Data Snapshot/);
    assert.doesNotMatch(contents, /Live First-Party Data/);
  });
});

describe('freshness markers on public pages', () => {
  const ROOT = path.resolve(__dirname, '..');
  const PAGES = [
    'public/learn.html',
    'public/lessons.html',
    'public/codex-plugin.html',
    'public/pro.html',
    'public/dashboard.html',
  ];

  for (const rel of PAGES) {
    it(`${rel} has a visible Updated: marker and JSON-LD dateModified`, () => {
      const full = path.join(ROOT, rel);
      const contents = fs.readFileSync(full, 'utf8');
      assert.match(
        contents,
        /Updated:\s*<time datetime="\d{4}-\d{2}-\d{2}"/,
        `${rel} must include a visible "Updated: <time>" marker`,
      );
      assert.match(
        contents,
        /"dateModified":\s*"\d{4}-\d{2}-\d{2}"/,
        `${rel} must include JSON-LD dateModified`,
      );
      assert.ok(
        contents.includes('"name": "Igor Ganapolsky"'),
        `${rel} must stamp consistent authorship (Igor Ganapolsky)`,
      );
    });
  }
});
