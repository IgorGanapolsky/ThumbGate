'use strict';

// Noise guards for feedback capture: semantic tags must be whole-word, corrective
// actions must come from genuinely similar past failures (never the event itself or
// an unrelated catch-all lesson), and risk alerts need samples plus lift.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { inferSemanticTags, addRiskBuckets } = require('../scripts/feedback-loop');
const { initDB, upsertLesson, inferCorrectiveActions } = require('../scripts/lesson-db');

describe('inferSemanticTags', () => {
  it('does not tag ordinary text containing user/prompt/recent as business entities', () => {
    const text = 'Paste-ready drafts were wrapped in blockquotes, so the user could not copy the prompt. Recent percent of runs failed.';
    assert.deepEqual(inferSemanticTags(text), []);
  });

  it('still tags real business terms', () => {
    assert.ok(inferSemanticTags('Pricing page lost paying customers at checkout').includes('entity:Revenue'));
    assert.ok(inferSemanticTags('Pricing page lost paying customers at checkout').includes('entity:Customer'));
    assert.ok(inferSemanticTags('Pricing page lost paying customers at checkout').includes('entity:Funnel'));
    assert.ok(inferSemanticTags('Campaign attribution broke ROI').includes('metric:ROI'));
  });
});

describe('inferCorrectiveActions relevance', () => {
  let db;
  let dbPath;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `noise-guard-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    db = initDB(dbPath);
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  function lesson(id, overrides = {}) {
    return {
      id,
      signal: 'negative',
      context: 'ctx',
      whatWentWrong: 'wrong',
      whatToChange: `fix for ${id}`,
      tags: [],
      timestamp: new Date().toISOString(),
      richContext: { domain: 'general' },
      ...overrides,
    };
  }

  it('never returns the event being captured as its own corrective action', () => {
    const current = lesson('fb_current', { tags: ['formatting', 'copy-paste'], whatToChange: 'Give drafts as plain text' });
    upsertLesson(db, current, { id: 'mem_current' });
    const actions = inferCorrectiveActions(db, { ...current, memoryId: 'mem_current' }, 3);
    assert.ok(!actions.includes('Give drafts as plain text'), `got ${JSON.stringify(actions)}`);
  });

  it('does not pair failures that only share generic or auto-inferred tags', () => {
    upsertLesson(db, lesson('fb_old', {
      tags: ['feedback', 'negative', 'entity:Customer', 'morning-brief'],
      whatToChange: 'Remove flow-cycle template from brief',
    }), { id: 'mem_old' });
    const current = lesson('fb_new', { tags: ['feedback', 'negative', 'entity:Customer', 'formatting'] });
    upsertLesson(db, current, { id: 'mem_new' });
    const actions = inferCorrectiveActions(db, { ...current, memoryId: 'mem_new' }, 3);
    assert.deepEqual(actions, []);
  });

  it('does not fall back to arbitrary lessons in the catch-all general domain', () => {
    upsertLesson(db, lesson('fb_unrelated', { tags: ['billing'], whatToChange: 'Unrelated billing fix' }), { id: 'mem_unrelated' });
    const current = lesson('fb_q', { tags: ['never-seen-tag'] });
    const actions = inferCorrectiveActions(db, current, 3);
    assert.deepEqual(actions, []);
  });

  it('still returns fixes from past failures sharing a specific tag', () => {
    upsertLesson(db, lesson('fb_prev', { tags: ['copy-paste'], whatToChange: 'Strip markdown before pasting' }), { id: 'mem_prev' });
    const current = lesson('fb_now', { tags: ['copy-paste'], whatToChange: 'Different advice' });
    upsertLesson(db, current, { id: 'mem_now' });
    const actions = inferCorrectiveActions(db, { ...current, memoryId: 'mem_now' }, 3);
    assert.deepEqual(actions, ['Strip markdown before pasting']);
  });
});

describe('addRiskBuckets', () => {
  it('skips small buckets and buckets with no lift over the base rate', () => {
    const output = { messages: [], remediations: [] };
    addRiskBuckets([
      { key: 'tiny', total: 3, highRisk: 3, riskRate: 1 },
      { key: 'no-lift', total: 40, highRisk: 20, riskRate: 0.5 },
    ], 'tag', output, 0.5);
    assert.equal(output.messages.length, 0);
  });

  it('flags a well-sampled bucket that is riskier than the base rate', () => {
    const output = { messages: [], remediations: [] };
    addRiskBuckets([{ key: 'deploy', total: 20, highRisk: 18, riskRate: 0.9 }], 'tag', output, 0.4);
    assert.equal(output.messages.length, 1);
    assert.match(output.messages[0], /deploy/);
  });
});
