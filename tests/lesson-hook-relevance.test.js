'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  estimateTokens,
  isRawTranscriptFragment,
  lessonMatchesToolCall,
  selectInjectableLessons,
  formatInjectableReminder,
  MAX_INJECTED_LESSONS,
  MAX_INJECTED_TOKENS,
  LESSON_REPEAT_MS,
} = require('../scripts/lesson-hook-relevance');
const { distillFeedbackHistory } = require('../scripts/feedback-history-distiller');

const thumbgateLesson = {
  id: 'lesson-billing',
  title: 'Do not redirect a blocked confirm to the Payment Link',
  whatToChange: 'Return 403 from scripts/billing.js when createCheckoutSession sees a fixture email.',
  tags: ['bash', 'billing'],
  metadata: { toolsUsed: ['Bash'], project: 'thumbgate' },
  scope: { projectId: 'thumbgate' },
};

const otherRepoLesson = {
  id: 'lesson-psn',
  title: 'StockService query',
  whatToChange: 'Run the Helix query in Eci.Psn.StockService before changing the document count.',
  tags: ['bash', 'repo:eci.psn.stockservice'],
  metadata: { toolsUsed: ['Bash'], project: 'Eci.Psn.StockService' },
  scope: { projectId: 'Eci.Psn.StockService' },
};

test('a lesson matches on repo scope and either the tool name or a command term', () => {
  assert.equal(lessonMatchesToolCall(thumbgateLesson, {
    toolName: 'Bash',
    actionContext: 'node scripts/billing.js --check',
    project: 'thumbgate',
  }), true);
  assert.equal(lessonMatchesToolCall(otherRepoLesson, {
    toolName: 'Bash',
    actionContext: 'node scripts/billing.js --check',
    project: 'thumbgate',
  }), false);
  assert.equal(lessonMatchesToolCall(thumbgateLesson, {
    toolName: 'Read',
    actionContext: 'scripts/billing.js',
    project: 'thumbgate',
  }), true);
  assert.equal(lessonMatchesToolCall(thumbgateLesson, {
    toolName: 'Bash',
    actionContext: 'echo hello',
    project: 'thumbgate',
  }), true);
  assert.equal(lessonMatchesToolCall({
    id: 'no-tool',
    whatToChange: 'Return 403 from scripts/billing.js when createCheckoutSession sees a fixture email.',
    tags: ['billing'],
    scope: { projectId: 'thumbgate' },
  }, {
    toolName: 'Read',
    actionContext: 'echo hello',
    project: 'thumbgate',
  }), false);
});

test('transcript fragments are never injected and capture stops producing them', () => {
  assert.equal(isRawTranscriptFragment('<task-notification> ignored'), true);
  assert.equal(isRawTranscriptFragment('<pasted_content> secret'), true);
  assert.equal(isRawTranscriptFragment('It ignored a prior instruction: <task-notification>'), true);
  const fragment = {
    id: 'fragment',
    whatToChange: 'It ignored a prior instruction: <task-notification>',
    tags: ['bash', 'billing'],
    metadata: { toolsUsed: ['Bash'] },
    scope: { projectId: 'thumbgate' },
  };
  assert.equal(lessonMatchesToolCall(fragment, {
    toolName: 'Bash',
    actionContext: 'node scripts/billing.js',
    project: 'thumbgate',
  }), false);

  const distilled = distillFeedbackHistory({
    signal: 'negative',
    chatHistory: [
      { author: 'user', text: '<task-notification> do not ignore this' },
      { author: 'user', text: '<pasted_content> never do that' },
    ],
  });
  assert.equal(distilled.lessonProposal, null);
  assert.equal(distilled.usedHistory, false);
});

test('nothing matches means no reminder and no hot-risk filler', () => {
  const selected = selectInjectableLessons([otherRepoLesson], {
    toolName: 'Bash',
    actionContext: 'node scripts/billing.js',
    project: 'thumbgate',
    sessionId: '',
    record: false,
  });
  assert.deepEqual(selected, []);
  assert.equal(formatInjectableReminder(selected), '');
  assert.doesNotMatch(formatInjectableReminder([]), /HOT RISK SIGNALS/);
});

test('injection is capped at two lessons and 150 tokens, and a lesson repeats only after 30 minutes', () => {
  const lessons = [1, 2, 3].map((n) => ({
    id: `lesson-${n}`,
    whatToChange: `Fix scripts/billing.js path ${n} ${'detail '.repeat(40)}`,
    tags: ['bash'],
    metadata: { toolsUsed: ['Bash'] },
    scope: { projectId: 'thumbgate' },
  }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-hook-relevance-'));
  const first = selectInjectableLessons(lessons, {
    toolName: 'Bash',
    actionContext: 'node scripts/billing.js',
    project: 'thumbgate',
    sessionId: 'sess-relevance',
    seenDir: dir,
    now: 1_000,
  });
  assert.equal(first.length, MAX_INJECTED_LESSONS);
  const reminder = formatInjectableReminder(first);
  assert.ok(estimateTokens(reminder) <= MAX_INJECTED_TOKENS, `reminder is ${estimateTokens(reminder)} tokens`);
  assert.doesNotMatch(reminder, /HOT RISK SIGNALS/);

  const repeated = selectInjectableLessons(lessons, {
    toolName: 'Bash',
    actionContext: 'node scripts/billing.js',
    project: 'thumbgate',
    sessionId: 'sess-relevance',
    seenDir: dir,
    now: 1_000 + LESSON_REPEAT_MS - 1,
  });
  assert.ok(repeated.every((lesson) => lesson.id === 'lesson-3'));
  assert.ok(!repeated.some((lesson) => lesson.id === 'lesson-1' || lesson.id === 'lesson-2'));

  const later = selectInjectableLessons(lessons, {
    toolName: 'Bash',
    actionContext: 'node scripts/billing.js',
    project: 'thumbgate',
    sessionId: 'sess-relevance',
    seenDir: dir,
    now: 1_000 + LESSON_REPEAT_MS,
  });
  assert.equal(later.length, MAX_INJECTED_LESSONS);
});

test('labeled ThumbGate calls recall the matching lesson and stay quiet otherwise', () => {
  const branchProtection = {
    id: 'mem_1791213888562_5s6xkd',
    whatToChange: 'When Igor says push, publish the pack on a public branch. Do not approve PRs, bypass branch protection, or force-push.',
    tags: ['feedback', 'negative', 'autonomy', 'push'],
  };
  const trunkMerge = {
    id: 'mem_1791827698393_8eyuwk',
    whatToChange: 'Rigorous adherence to zero-bypass branch protection, waiting for terminal green CI before a Trunk merge request.',
    tags: ['feedback', 'positive', 'pr-management', 'rulesets', 'trunk-merge'],
  };
  const ruleset = {
    id: 'mem_1791473268729_xfc0rs',
    whatToChange: 'Ruleset requires thread resolution before Trunk merges. Diagnosed the blocker without bypassing branch protection.',
    tags: ['feedback', 'positive', 'ui-components'],
  };
  const healthClaim = {
    id: 'mem_1793117232257_ek7dn4',
    whatToChange: 'Keep production host claims tied to a fresh /health curl after checking Railway.',
    tags: ['feedback', 'negative', 'aws', 'console', 'decision'],
  };
  const railwayDeploy = {
    id: 'mem_1791740937919_yyv5js',
    whatToChange: 'The failed Deploy to Railway check stayed in place. Use the existing Railway login and CLI to repair the live lesson store and recheck the export.',
    tags: ['feedback', 'negative', 'railway', 'dpo', 'autonomy'],
  };
  const marketingAside = {
    id: 'mem_1793217824434_f2b1gh',
    whatToChange: 'Keep the PreToolUse blocks for secret egress and force-push to main. Stop presenting a token percent as the reason a cache-heavy week got cheaper.',
    tags: ['feedback', 'negative', 'token-claim', 'marketing-honesty'],
  };
  const heroAside = {
    id: 'mem_1793126088335_dz84k1',
    whatToChange: 'The live thumbgate.ai hero shows force-push as denied. Keep Pro at $19/mo and the $499 diagnostic.',
    tags: ['feedback', 'negative', 'homepage', 'pricing'],
  };
  const dayglassForce = {
    id: 'mem_1791308735484_fqv4d5',
    whatToChange: 'Never propose force-push or a history rewrite.',
    tags: ['feedback', 'negative', 'git-flow', 'force-push', 'dayglass'],
  };
  const corpus = [
    marketingAside,
    heroAside,
    dayglassForce,
    otherRepoLesson,
    healthClaim,
    railwayDeploy,
    ruleset,
    trunkMerge,
    branchProtection,
  ];
  const branchIds = [branchProtection.id, trunkMerge.id, ruleset.id];
  const relevant = [
    ['git push --force origin main', branchIds],
    ['git push origin main', branchIds],
    ['ls && sudo git push origin main', branchIds],
    ['git -C /var/folders/66/fkp57h8x6b5flyn92lzry7nm0000gp/T/tg-bypass-pEt5Lt push --force origin main', branchIds],
    ['echo git push --force', branchIds],
    ['gh pr merge 123 --auto --squash', branchIds],
    ['curl -s https://thumbgate-production.up.railway.app/health', [healthClaim.id]],
    ['railway deploy', [railwayDeploy.id]],
    ["sed -i '' 's#https://thumbgate-production.up.railway.app#https://thumbgate.ai#g' CLAUDE.md .github/workflows/deploy-verify.yml", [railwayDeploy.id, healthClaim.id]],
    ['RAILWAY_TOKEN=fixture railway deploy', [railwayDeploy.id]],
  ];
  const irrelevant = [
    'echo hello',
    'ls -la',
    'git status',
    'git diff',
    'git log --oneline -5',
    'command -v node',
    'echo hi && ls',
    'sudo ls /var/log',
    'echo only-check-receipt',
    'grep -r "git add" docs/',
  ];
  let recall = 0;
  let falseHits = 0;
  let tokens = 0;
  for (const [command, expectIds] of relevant) {
    const selected = selectInjectableLessons(corpus, {
      toolName: 'Bash',
      actionContext: command,
      project: 'thumbgate',
      record: false,
    });
    tokens += estimateTokens(formatInjectableReminder(selected));
    const ids = selected.map((lesson) => lesson.id);
    if (expectIds.some((id) => ids.includes(id))) recall += 1;
  }
  for (const command of irrelevant) {
    const selected = selectInjectableLessons(corpus, {
      toolName: 'Bash',
      actionContext: command,
      project: 'thumbgate',
      record: false,
    });
    tokens += estimateTokens(formatInjectableReminder(selected));
    if (selected.length > 0) falseHits += 1;
  }
  const tokensPerCall = Math.round((tokens / (relevant.length + irrelevant.length)) * 10) / 10;
  assert.equal(recall, 10, `recall ${recall}/10 tokens/call ${tokensPerCall}`);
  assert.equal(falseHits, 0, `false ${falseHits}/10 tokens/call ${tokensPerCall}`);
  assert.equal(tokensPerCall, 41.8);
  assert.ok(tokensPerCall <= MAX_INJECTED_TOKENS);
});
