'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateCorporateEmailIsolationGate,
  compileEnveloppeVaultNoteForEgress,
  reconcileEnveloppeAutoClean,
} = require('../scripts/corporate-email-isolation-diode');

test('evaluateCorporateEmailIsolationGate: hard-blocks @ecisolutions.com, @ecinexus.com, Outlook.app, and bare display-name autocomplete', () => {
  const eciLeak = evaluateCorporateEmailIsolationGate({
    toolName: 'gmail_send',
    recipients: ['iganapolsky@ecisolutions.com', 'boardy@boardy.ai'],
  });
  assert.equal(eciLeak.allowed, false);
  assert.equal(eciLeak.gateId, 'gate:security:eci_corporate_email_isolation');

  const eciNexusLeak = evaluateCorporateEmailIsolationGate({
    toolName: 'Bash',
    commandOrPayload: 'curl https://mail.google.com/mail/u/0/?view=cm&to=user@ecinexus.com',
  });
  assert.equal(eciNexusLeak.allowed, false);
  assert.equal(eciNexusLeak.gateId, 'gate:security:eci_corporate_email_isolation');

  const bareName = evaluateCorporateEmailIsolationGate({
    toolName: 'gmail_compose',
    commandOrPayload: 'https://mail.google.com/mail/u/0/?view=cm&to=Igor%20Ganapolsky',
  });
  assert.equal(bareName.allowed, false);
  assert.equal(bareName.gateId, 'gate:security:ambiguous_self_recipient_autocomplete');

  const safePersonal = evaluateCorporateEmailIsolationGate({
    toolName: 'gmail_send',
    recipients: ['iganapolsky@gmail.com', 'boardy@boardy.ai'],
    commandOrPayload: 'ThumbGate x Hotdata POC update',
  });
  assert.equal(safePersonal.allowed, true);
});

test('compileEnveloppeVaultNoteForEgress: enforces share:true default-deny, blocks corp-to-personal egress, and compiles WikiLinks', () => {
  // Default-deny when share !== true
  const unshared = compileEnveloppeVaultNoteForEgress({
    frontmatter: { categories: ['[[Projects]]'] },
    body: 'Internal draft note',
  });
  assert.equal(unshared.allowed, false);
  assert.equal(unshared.gateId, 'gate:enveloppe:share_false_default_deny');

  // Blocks corporate ECI note even if share: true when target is personal GitHub
  const corpLeak = compileEnveloppeVaultNoteForEgress({
    frontmatter: { share: true },
    body: 'Contact iganapolsky@ecisolutions.com for DIST03-1755 on 10.10.20.83',
    targetRepo: 'IgorGanapolsky/ThumbGate',
  });
  assert.equal(corpLeak.allowed, false);
  assert.equal(corpLeak.gateId, 'gate:enveloppe:corp_to_personal_repo_blocked');

  // Blocks CFO financial note even if share: true
  const cfoLeak = compileEnveloppeVaultNoteForEgress({
    frontmatter: { share: true, categories: ['[[Debts]]'], balance_usd: 14200 },
    body: 'Amex statement',
    targetRepo: 'IgorGanapolsky/ThumbGate',
  });
  assert.equal(cfoLeak.allowed, false);
  assert.equal(cfoLeak.gateId, 'gate:enveloppe:cfo_finance_diode_blocked');

  // Blocks transitive embed (![[PrivateChild]]) when child note is share: false or corporate
  const transitiveLeak = compileEnveloppeVaultNoteForEgress({
    frontmatter: { share: true },
    body: 'Public summary with ![[Private-Internal-Roadmap]] embedded.',
    targetRepo: 'IgorGanapolsky/ThumbGate',
    vaultNotes: {
      'Private-Internal-Roadmap': {
        frontmatter: { share: false },
        body: 'Secret roadmap details',
      },
    },
  });
  assert.equal(transitiveLeak.allowed, false);
  assert.equal(transitiveLeak.gateId, 'gate:enveloppe:transitive_embed_leak_blocked');

  // Allows verified personal note with share: true, strips %% comments and .base views, and converts [[WikiLinks]]
  const validPersonal = compileEnveloppeVaultNoteForEgress({
    frontmatter: { share: true, categories: ['[[Projects]]'] },
    body: 'See [[ThumbGate Hotdata POC|Hotdata POC]] for benchmarks. %% internal scratchpad %%\n![[Views/Project-Tracker.base]]',
    targetRepo: 'IgorGanapolsky/ThumbGate',
  });
  assert.equal(validPersonal.allowed, true);
  assert.equal(validPersonal.compiledBody.trim(), 'See [Hotdata POC](./thumbgate-hotdata-poc.md) for benchmarks.');
});

test('reconcileEnveloppeAutoClean: prunes depublished notes while preserving excluded repo paths', () => {
  const reconciliation = reconcileEnveloppeAutoClean({
    vaultNotes: [
      { frontmatter: { share: true }, targetPath: 'docs/notes/active-architecture.md' },
      { frontmatter: { share: false }, targetPath: 'docs/notes/depublished-draft.md' },
    ],
    publishedRepoPaths: [
      'README.md',
      'AGENTS.md',
      'docs/notes/active-architecture.md',
      'docs/notes/depublished-draft.md',
      'docs/notes/deleted-note.md',
    ],
  });
  assert.deepEqual(reconciliation.toDelete, [
    'docs/notes/depublished-draft.md',
    'docs/notes/deleted-note.md',
  ]);
  assert.deepEqual(reconciliation.retained, [
    'README.md',
    'AGENTS.md',
    'docs/notes/active-architecture.md',
  ]);
});
