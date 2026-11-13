'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { HarnessMaturityAudit } = require('../src/harness-maturity-audit');
const { GtmPlayEngine } = require('../src/gtm-play-engine');

describe('HarnessMaturityAudit (Dan Kornas Maturity Ladder)', () => {
  it('should scan the ThumbGate repository and report maturity level and 6-dimension breakdown', () => {
    const auditor = new HarnessMaturityAudit({ rootDir: path.join(__dirname, '..') });
    const audit = auditor.auditRepository();

    assert.ok(audit.overallPercentage > 50, `Expected score > 50%, got ${audit.overallPercentage}%`);
    assert.ok(['L2', 'L3', 'L4'].includes(audit.maturity), `Expected maturity L2+, got ${audit.maturity}`);
    assert.ok(audit.dimensionScores.guides);
    assert.ok(audit.dimensionScores.skills);
    assert.ok(audit.dimensionScores.guardrails);
    assert.ok(audit.dimensionScores.feedback);
    assert.ok(audit.dimensionScores.ci);
    assert.ok(audit.dimensionScores.hygiene);

    assert.strictEqual(audit.isCompliant('L1'), true);
  });
});

describe('GtmPlayEngine (Pancake.ai GTM Factory)', () => {
  it('should score leads based on ICP title, stage, and trigger signals', () => {
    const tmpStorage = path.join(os.tmpdir(), `gtm_test_${Date.now()}.json`);
    const engine = new GtmPlayEngine({ storagePath: tmpStorage });

    const highFitLead = {
      name: 'Sarah Connor',
      title: 'VP of Engineering',
      company: 'Skynet AI',
      companyStage: 'Series A',
      trigger: 'autonomous agent broke production with un-indexed queries',
    };

    const score = engine.scoreLead(highFitLead);
    assert.ok(score >= 0.85, `Expected high score >= 0.85, got ${score}`);

    // Create a play and generate outreach draft
    const play = engine.createPlay({
      name: 'Agent Production Outage Recovery',
    });

    const draft = engine.generateOutreachDraft(highFitLead, play);
    assert.strictEqual(draft.status, 'STAGED_FOR_APPROVAL');
    assert.strictEqual(draft.requiresApproval, true);
    assert.ok(draft.body.includes('ThumbGate'));

    // Approve the lead and verify reward loop
    const approved = engine.approveLeadOutreach(draft.leadId);
    assert.strictEqual(approved.ok, true);
    assert.strictEqual(approved.status, 'APPROVED');

    // Clean up
    if (fs.existsSync(tmpStorage)) fs.unlinkSync(tmpStorage);
  });
});
