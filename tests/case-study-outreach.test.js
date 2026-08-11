'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CASES,
  withUtm,
  buildPack,
  generate,
} = require('../scripts/generate-case-study-outreach');

describe('case-study outreach generator', () => {
  it('exposes the sudo-evasion dogfood case', () => {
    assert.ok(CASES['sudo-evasion']);
    assert.match(CASES['sudo-evasion'].metric, /62/);
  });

  it('exposes the memory-compaction dogfood case with honest metrics', () => {
    assert.ok(CASES['memory-compaction']);
    assert.match(CASES['memory-compaction'].metric, /3 dupe records/);
    assert.match(CASES['memory-compaction'].result, /opposite-signal lessons never merge/);
  });

  it('attaches first-party UTMs without inventing customer logos', () => {
    const url = withUtm('https://thumbgate.ai', '/case-studies#sudo-evasion', 'case_sudo_evasion', 'linkedin');
    assert.match(url, /utm_source=case_study_outreach/);
    assert.match(url, /utm_medium=linkedin/);
    assert.match(url, /utm_campaign=case_sudo_evasion/);
    assert.match(url, /#sudo-evasion$/);
  });

  it('builds channel copy with proof + diagnostic CTA', () => {
    const pack = buildPack(CASES['sudo-evasion'], { baseUrl: 'https://thumbgate.ai' });
    assert.match(pack.channels.linkedin, /62/);
    assert.match(pack.channels.email, /Diagnostic/i);
    assert.match(pack.channels.reddit, /case-studies/);
    assert.match(pack.markdown, /Honesty/);
    assert.doesNotMatch(pack.markdown, /Fortune 500|customer logo wall/i);
    assert.match(pack.links.diagnostic, /utm_campaign=case_sudo_evasion/);
    assert.match(pack.channels.email, /^Subject: A guardrail you could walk past with sudo/);
  });

  it('writes a markdown pack on --write', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-outreach-'));
    const result = generate({
      caseId: 'sudo-evasion',
      write: true,
      outDir: tmp,
      baseUrl: 'https://thumbgate.ai',
    });
    assert.ok(result.outPath);
    assert.ok(fs.existsSync(result.outPath));
    const body = fs.readFileSync(result.outPath, 'utf8');
    assert.match(body, /Outreach pack/);
    assert.match(body, /case_study_outreach/);
  });

  it('rejects unknown case ids', () => {
    assert.throws(() => generate({ caseId: 'not-a-real-case' }), /Unknown case id/);
  });
});
