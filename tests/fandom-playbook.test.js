'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { scanAgentSafetyIndex } = require('../scripts/agent-safety-index');
const {
  evaluateFleetRank,
  generateSvgBadge,
  getMarkdownBadgeCode,
  MILESTONES,
} = require('../scripts/fandom-gamification-badges');

test('David Meerman Scott Steal: Hagerty-Style Agent Safety Scanner', async (t) => {
  await t.test('detects missing tests and unconfined secrets', () => {
    const tmpDir = path.join(os.tmpdir(), `tg_scan_test_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      // Put an unconfined .env with API key
      fs.writeFileSync(path.join(tmpDir, '.env'), 'OPENAI_API_KEY=sk-test1234567890\nSECRET_KEY=confidential', 'utf8');

      const result = scanAgentSafetyIndex(tmpDir);

      assert.ok(result.safetyScore < 60);
      assert.equal(result.isHardened, false);
      assert.ok(result.findings.some(f => f.category === 'Credential Confinement'));
      assert.ok(result.findings.some(f => f.category === 'Test Hardening'));
      assert.ok(result.findings.some(f => f.category === 'CI Tsunami Defense'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('scores hardened repos with 100% when all safety diodes and CI controls exist', () => {
    const tmpDir = path.join(os.tmpdir(), `tg_scan_clean_${Date.now()}`);
    fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.github', 'workflows'), { recursive: true });

    try {
      // Clean package.json with test:mutation
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        name: 'hardened-repo',
        scripts: { 'test:mutation': 'node scripts/mutation.js' },
      }), 'utf8');

      // Workflow with concurrency cancel-in-progress: true
      fs.writeFileSync(path.join(tmpDir, '.github', 'workflows', 'ci.yml'), `
        name: CI
        concurrency:
          group: \${{ github.workflow }}-\${{ github.ref }}
          cancel-in-progress: true
      `, 'utf8');

      const result = scanAgentSafetyIndex(tmpDir);

      assert.equal(result.safetyScore, 100);
      assert.equal(result.isHardened, true);
      assert.equal(result.findingsCount, 0);
      assert.ok(result.maturityLevel.includes('Level 3: Hardened'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('penalizes scatter queries when sample SQL is audited', () => {
    const tmpDir = path.join(os.tmpdir(), `tg_scan_sql_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      const result = scanAgentSafetyIndex(tmpDir, {
        sampleSql: 'SELECT * FROM accounts WHERE status = "active";',
      });

      assert.ok(result.findings.some(f => f.category === 'Database Resilience'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

test('David Meerman Scott Steal: Gamified Milestones and Verifiable Badges', async (t) => {
  await t.test('evaluates milestone ranks correctly', () => {
    // 0 milestones
    const rank0 = evaluateFleetRank([]);
    assert.equal(rank0.score, 0);
    assert.equal(rank0.certified, false);
    assert.ok(rank0.rank.includes('Level 1'));

    // 3 milestones (60 points)
    const rank3 = evaluateFleetRank(['credential_confinement', 'mechanical_verifier', 'mutation_hardening']);
    assert.equal(rank3.score, 60);
    assert.equal(rank3.certified, false);
    assert.ok(rank3.rank.includes('Level 2'));

    // All 5 milestones (100 points)
    const allIds = MILESTONES.map(m => m.id);
    const rank5 = evaluateFleetRank(allIds);
    assert.equal(rank5.score, 100);
    assert.equal(rank5.certified, true);
    assert.ok(rank5.rank.includes('Certified Agent Architect'));
    assert.equal(rank5.badgeText, 'Level 3 Hardened 🛡️');
  });

  await t.test('generates compliant SVG badge XML', () => {
    const rank = evaluateFleetRank(MILESTONES.map(m => m.id));
    const svg = generateSvgBadge(rank);

    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.endsWith('</svg>'));
    assert.ok(svg.includes('thumbgate'));
    assert.ok(svg.includes('Level 3 Hardened'));
    assert.ok(svg.includes('#4c1'));
  });

  await t.test('generates valid markdown badge snippet', () => {
    const md = getMarkdownBadgeCode('test-org/repo');
    assert.ok(md.includes('https://thumbgate.ai/badge/test-org/repo.svg'));
    assert.ok(md.includes('https://thumbgate.ai'));
  });
});
