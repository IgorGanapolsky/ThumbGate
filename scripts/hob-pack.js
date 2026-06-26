#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DATE = '2026-06-24';
const REPORT_SLUG = 'human-on-the-bridge-pack';
const APPROVAL_PHRASE = `APPROVED: publish HOB ThumbGate response pack ${DEFAULT_DATE}`;
const OUTREACH_APPROVAL_PHRASE = 'APPROVED: send HOB ThumbGate outreach to <target>';

const LINKS = Object.freeze({
  paper: 'https://arxiv.org/abs/2606.16871',
  sourcePost: 'https://x.com/omarsar0/status/2068743256079556989',
  thumbgate: 'https://thumbgate.ai',
  thumbgateCheckout: 'https://thumbgate.ai/checkout/pro',
  thumbgateGatekeeperCompare: 'https://thumbgate.ai/compare/oak-and-sparrow-gatekeeper',
  thumbgateRepo: 'https://github.com/IgorGanapolsky/ThumbGate',
  gatekeeper: 'https://oakandsparrowsystemsenterprise.io',
  gatekeeperEvent: 'https://www.deep-tech-week.com/sf-2026/events/gatekeeper-deterministic-ai-governance-subtitle-refusal-is-t',
  commercialTruth: 'docs/COMMERCIAL_TRUTH.md',
  verificationEvidence: 'docs/VERIFICATION_EVIDENCE.md',
  gatekeeperRule: 'reports/gtm/2026-06-24-gatekeeper-promise-repair/DAILY_GATEKEEPER_CONTENT_RULE.md',
});

function normalizeText(value) {
  return String(value ?? '').trim();
}

function runJsonCommand(args, repoRoot = REPO_ROOT) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15_000,
  });
  const stdout = normalizeText(result.stdout);
  const stderr = normalizeText(result.stderr);

  if (result.status !== 0 || !stdout) {
    return {
      ok: false,
      status: result.status,
      stdout,
      stderr,
    };
  }

  try {
    return {
      ok: true,
      status: result.status,
      data: JSON.parse(stdout),
    };
  } catch (error) {
    return {
      ok: false,
      status: result.status,
      stdout,
      stderr: stderr || error.message,
    };
  }
}

function collectLocalEvidence(repoRoot = REPO_ROOT) {
  const pipeline = runJsonCommand(['scripts/sales-pipeline.js', 'summary'], repoRoot);
  const stripe = runJsonCommand(['scripts/stripe-live-status.js'], repoRoot);

  return {
    generatedAt: new Date().toISOString(),
    production: {
      healthUrl: 'https://thumbgate.ai/health',
      healthObserved: 'Verified in this operator run: HTTP 200 JSON status ok, version 1.27.15.',
      checkoutUrl: LINKS.thumbgateCheckout,
      checkoutObserved: 'Verified in this operator run: HTTP 200 for /checkout/pro.',
    },
    pipeline: pipeline.ok ? pipeline.data : { unavailable: pipeline },
    stripe: stripe.ok ? stripe.data : { unavailable: stripe },
    commercialTruth: {
      path: LINKS.commercialTruth,
      summary: 'Current offer truth: Free local CLI, Pro at $19/mo or $149/yr, Enterprise/custom intake-led sprint. No same-day paid proof in this evidence window.',
    },
    gatekeeper: {
      rulePath: LINKS.gatekeeperRule,
      url: LINKS.gatekeeper,
      eventUrl: LINKS.gatekeeperEvent,
      promise: 'Daily ThumbGate content must include the Gatekeeper/Oak & Sparrow field-proof angle and link exposure when relevant.',
    },
  };
}

function buildHobPack(options = {}) {
  const date = normalizeText(options.date) || DEFAULT_DATE;
  const generatedAt = normalizeText(options.generatedAt) || new Date().toISOString();
  const evidence = options.evidence || {};

  const reusableAssets = [
    {
      key: 'red_team_traps',
      title: 'Red-team trap templates',
      buyerProblem: 'Agent teams need repeatable failure probes instead of one-off human review.',
      thumbgateImplementation: 'Convert expert-labeled failure cases into pre-action trap prompts and blocked tool-call examples.',
      exampleAssets: [
        'Prompt-injection trap: external page asks the agent to ignore local policy before a file write.',
        'Privilege trap: agent attempts production data access without an explicit ticket or owner approval.',
        'Retrieval trap: agent cites a stale RAG lesson when current evidence is required.',
      ],
    },
    {
      key: 'juror_personas',
      title: 'Juror persona templates',
      buyerProblem: 'Human judgment does not scale unless the judgment role is specified.',
      thumbgateImplementation: 'Define reviewer personas such as security lead, platform owner, compliance owner, and incident commander, then map each to gates and scoring weights.',
      exampleAssets: [
        'Security lead: blocks secret exposure, unsafe shell commands, and unknown external fetches.',
        'Platform owner: blocks deploys without health, rollback, and ownership evidence.',
        'Revenue owner: blocks money claims without payment-provider truth.',
      ],
    },
    {
      key: 'scoring_guidelines',
      title: 'Scoring guideline templates',
      buyerProblem: 'Agent evals are hard to compare when every reviewer scores risk differently.',
      thumbgateImplementation: 'Turn expert criteria into explicit pass, warn, block, and escalate thresholds with evidence fields.',
      exampleAssets: [
        'Pass: action has current source evidence, owner context, reversible execution, and no restricted data.',
        'Warn: action is reversible but missing a fresh source or test readback.',
        'Block: action can affect money, users, production, or confidential data without current proof.',
      ],
    },
    {
      key: 'fallback_policy_gates',
      title: 'Fallback-policy gates',
      buyerProblem: 'When the agent is uncertain, it often keeps going instead of falling back safely.',
      thumbgateImplementation: 'Add deterministic fallback gates: ask for approval, draft only, dry-run only, or stop with unknowns labeled.',
      exampleAssets: [
        'External side effect fallback: draft the exact post/email, require action-time approval, then send only after approval.',
        'Payment fallback: use provider truth first; if secrets are missing, label revenue as unknown or zero-proof.',
        'Research fallback: if current source is unreachable, label unknowns rather than filling the gap from memory.',
      ],
    },
    {
      key: 'evidence_receipts',
      title: 'Evidence-linked run reports',
      buyerProblem: 'A successful eval run is not useful if nobody can audit why it passed.',
      thumbgateImplementation: 'Emit receipts with source URLs, command output summaries, gate decisions, and next-state instructions.',
      exampleAssets: [
        'Gate decision receipt: rule id, evidence path, action attempted, decision, next allowed action.',
        'Revenue receipt: provider status, checkout status, pipeline state, money truth.',
        'Content receipt: platform, draft text, required links, approval phrase, posting blocker or live URL.',
      ],
    },
  ];

  const offer = {
    name: 'Human-on-the-Bridge Workflow Hardening Sprint',
    positioning: 'Convert expert judgment about one real agent workflow into reusable ThumbGate checks, receipts, and fallback policies.',
    buyer: 'AI agent platform teams, automation agencies, eval teams, and compliance-sensitive engineering leaders.',
    scope: [
      'Select one load-bearing workflow and one failure mode.',
      'Extract expert judgment into red-team traps, juror personas, scoring guidelines, and fallback gates.',
      'Wire the resulting checks into a ThumbGate runbook with evidence receipts.',
      'Return a before/after action plan that the team can use without putting an LLM in the final policy seat.',
    ],
    commercialGuardrail: 'Do not invent a cash win. Current evidence supports workflow-hardening and intake-led sprint positioning, not same-day paid revenue.',
    callToAction: 'Send one agent workflow and the failure mode you most want to stop repeating.',
  };

  return {
    date,
    generatedAt,
    title: 'Human-on-the-Bridge ThumbGate Pack',
    thesis: 'Human-on-the-Bridge is a strong external framing for ThumbGate because it says expert judgment should move upstream into reusable evaluation assets. ThumbGate is the runtime side: those assets become deterministic pre-action gates, fallback policies, and evidence receipts.',
    unknowns: [
      'Unknown: whether the paper authors, Omar, Dair.ai, or ProofAgent want a ThumbGate collaboration.',
      'Unknown: whether the Gatekeeper event attendee list will contain qualified buyers until Nick/Josh send it.',
      'Unknown: current payment-provider revenue until Stripe or PayPal provider truth shows paid events.',
    ],
    links: { ...LINKS },
    evidence,
    reusableAssets,
    offer,
    contentQueue: buildContentQueue(date),
    outreachQueue: buildOutreachQueue(date),
  };
}

function buildContentQueue(date = DEFAULT_DATE) {
  return [
    {
      platform: 'LinkedIn',
      status: 'draft_only',
      purpose: 'Thought-leadership post that ties HOB to ThumbGate and gives Gatekeeper partner exposure.',
      requiredLinks: [LINKS.paper, LINKS.thumbgate, LINKS.gatekeeper],
      text: [
        'Human-on-the-Bridge is the clearest framing I have seen this week for agent evals:',
        '',
        'Do not keep expert judgment trapped in one-off reviews. Move it upstream into reusable evaluation assets.',
        '',
        'That is exactly where ThumbGate fits. Expert feedback becomes deterministic pre-action checks, fallback gates, and evidence receipts before an agent touches code, money, customer systems, or external tools.',
        '',
        'The live field context for this ThumbGate cycle is Gatekeeper by Oak & Sparrow. Gatekeeper focuses on deterministic AI governance before data leaves the building; ThumbGate focuses on pre-action checks before coding agents execute risky tool calls. Same direction: prove the action before execution.',
        '',
        `Paper: ${LINKS.paper}`,
        `ThumbGate: ${LINKS.thumbgate}`,
        `Gatekeeper / Oak & Sparrow: ${LINKS.gatekeeper}`,
      ].join('\n'),
      approval: APPROVAL_PHRASE,
    },
    {
      platform: 'X',
      status: 'draft_only',
      purpose: 'Short response to Omar/Dair.ai without claiming affiliation.',
      requiredLinks: [LINKS.paper, LINKS.thumbgate],
      text: [
        'Strong framing. Human-on-the-Bridge maps cleanly to the missing runtime layer for agent evals:',
        '',
        'expert judgment -> reusable eval assets -> deterministic pre-action gates -> evidence receipts',
        '',
        `That is what ThumbGate is building for coding agents: ${LINKS.thumbgate}`,
        `Paper: ${LINKS.paper}`,
      ].join('\n'),
      approval: APPROVAL_PHRASE,
    },
    {
      platform: 'Medium',
      status: 'draft_only',
      purpose: 'Article outline for the required daily article lane.',
      requiredLinks: [LINKS.paper, LINKS.thumbgate, LINKS.gatekeeper, LINKS.thumbgateGatekeeperCompare],
      title: 'Human-on-the-Bridge Is the Missing Bridge Between Agent Evals and Runtime Gates',
      outline: [
        '1. The eval problem: agents are behavioral systems, not static benchmarks.',
        '2. The HOB insight: expert judgment should be front-loaded into reusable assets.',
        '3. ThumbGate implementation: red-team traps, juror personas, scoring guidelines, fallback gates, and evidence receipts.',
        '4. Gatekeeper field note: Gatekeeper covers workforce-input governance; ThumbGate covers coding-agent action governance.',
        '5. Practical CTA: send one workflow and one failure mode to convert into gates.',
      ],
      approval: APPROVAL_PHRASE,
    },
    {
      platform: 'Reddit',
      status: 'draft_only',
      purpose: 'Technical-first version that avoids partner/event links by default.',
      requiredLinks: [LINKS.paper, LINKS.thumbgateRepo],
      text: [
        'I built a small implementation pack for turning Human-on-the-Bridge-style expert judgment into runtime checks for AI coding agents.',
        '',
        'The shape is:',
        '- red-team trap templates',
        '- juror/reviewer personas',
        '- scoring guidelines',
        '- fallback-policy gates',
        '- evidence-linked receipts',
        '',
        `Paper: ${LINKS.paper}`,
        `Repo: ${LINKS.thumbgateRepo}`,
        '',
        'Free to try locally via npx thumbgate init. Paid tiers are optional.',
      ].join('\n'),
      approval: APPROVAL_PHRASE,
    },
  ];
}

function buildOutreachQueue(date = DEFAULT_DATE) {
  return [
    {
      target: 'Omar / Dair.ai',
      channel: 'X or LinkedIn reply',
      score: 18,
      reason: 'Posted the HOB paper and already frames the problem as scalable evaluation for agents.',
      evidence: [LINKS.sourcePost, LINKS.paper],
      proposedAction: 'Reply with a compact HOB-to-ThumbGate runtime-gate mapping.',
      draft: [
        'Saw your HOB note. The paper maps really cleanly to a runtime implementation pattern:',
        '',
        'human expert judgment -> reusable eval assets -> deterministic pre-action gates -> receipts',
        '',
        'ThumbGate is building that last mile for coding agents. If useful, I can share the small implementation pack: red-team traps, juror personas, scoring guidelines, fallback gates, and evidence receipts.',
      ].join('\n'),
      approval: OUTREACH_APPROVAL_PHRASE.replace('<target>', 'Omar / Dair.ai'),
    },
    {
      target: 'ProofAgent / HOB paper author lane',
      channel: 'public reply or email only after verified contact source',
      score: 16,
      reason: 'Direct thematic fit: ThumbGate can operationalize reusable expert judgment at the pre-action boundary.',
      evidence: [LINKS.paper],
      proposedAction: 'Offer a draft implementation mapping, not a partnership claim.',
      draft: [
        'Your Human-on-the-Bridge framing is useful because it makes expert judgment reusable instead of trapping it in per-output review.',
        '',
        'I am mapping that into ThumbGate as a practical runtime pack for coding agents: traps, reviewer personas, score thresholds, fallback gates, and auditable receipts.',
        '',
        'Happy to share the mapping if it is useful for implementation examples.',
      ].join('\n'),
      approval: OUTREACH_APPROVAL_PHRASE.replace('<target>', 'ProofAgent / HOB author lane'),
    },
    {
      target: 'Gatekeeper / Oak & Sparrow',
      channel: 'existing Gmail thread only with action-time approval',
      score: 15,
      reason: 'Existing field collaboration requires daily exposure and gives the HOB story a concrete live governance context.',
      evidence: [LINKS.gatekeeper, LINKS.gatekeeperEvent, LINKS.gatekeeperRule],
      proposedAction: 'Share the HOB pack as a sponsor-aligned field note and ask for the workflow to inspect.',
      draft: [
        'Nick, quick field note for the event context: the Human-on-the-Bridge paper gives us a clean explanation for why Gatekeeper and ThumbGate fit.',
        '',
        'Gatekeeper moves workforce AI governance before data leaves the building. ThumbGate moves coding-agent checks before risky tool actions execute. Both turn judgment into proof before action.',
        '',
        'If Josh has the workflow ready, send the one workflow/failure mode and I will convert it into the inspection pack.',
      ].join('\n'),
      approval: OUTREACH_APPROVAL_PHRASE.replace('<target>', 'Gatekeeper / Oak & Sparrow'),
    },
  ].map((entry) => ({ ...entry, date }));
}

function renderEvidenceLedger(pack) {
  const pipeline = pack.evidence?.pipeline?.summary;
  const stripe = pack.evidence?.stripe;
  const stageJson = pipeline?.byStage ? JSON.stringify(pipeline.byStage) : 'unknown';
  const stripeStatus = normalizeText(stripe?.status || stripe?.stripe?.status || stripe?.unavailable?.stderr) || 'unknown';

  return [
    '# Human-on-the-Bridge Pack Evidence Ledger',
    '',
    `Generated: \`${pack.generatedAt}\``,
    `Date: \`${pack.date}\``,
    '',
    '## Current External Evidence',
    '',
    `- HOB paper: ${pack.links.paper}`,
    `- Source post: ${pack.links.sourcePost}`,
    `- ThumbGate production health: ${pack.evidence?.production?.healthObserved || 'unknown'}`,
    `- ThumbGate checkout route: ${pack.evidence?.production?.checkoutObserved || 'unknown'}`,
    `- Gatekeeper / Oak & Sparrow: ${pack.links.gatekeeper}`,
    `- Gatekeeper event proof: ${pack.links.gatekeeperEvent}`,
    '',
    '## Money Truth',
    '',
    `- Pipeline stage counts: \`${stageJson}\``,
    `- Pipeline paid count: \`${pipeline?.paid ?? 0}\``,
    `- Pipeline booked revenue cents: \`${pipeline?.bookedRevenueCents ?? 0}\``,
    `- Stripe status: \`${stripeStatus}\``,
    '- Revenue conclusion: no same-day paid event is proven by this evidence window.',
    '',
    '## Commercial Guardrails',
    '',
    `- Commercial truth source: ${pack.links.commercialTruth}`,
    `- Verification evidence source: ${pack.links.verificationEvidence}`,
    '- Allowed claim: ThumbGate has a live workflow-hardening motion and a reachable production/checkout path.',
    '- Blocked claim: do not say HOB/Gatekeeper produced paid revenue until payment-provider truth proves it.',
    '',
  ].join('\n');
}

function renderHobPack(pack) {
  const assetLines = pack.reusableAssets.flatMap((asset) => ([
    `### ${asset.title}`,
    '',
    `- Buyer problem: ${asset.buyerProblem}`,
    `- ThumbGate implementation: ${asset.thumbgateImplementation}`,
    '- Example assets:',
    ...asset.exampleAssets.map((item) => `  - ${item}`),
    '',
  ]));

  return [
    '# Human-on-the-Bridge ThumbGate Pack',
    '',
    `Generated: \`${pack.generatedAt}\``,
    '',
    '## Thesis',
    '',
    pack.thesis,
    '',
    '## Source Links',
    '',
    `- Paper: ${pack.links.paper}`,
    `- Source post: ${pack.links.sourcePost}`,
    `- ThumbGate: ${pack.links.thumbgate}`,
    `- Gatekeeper / Oak & Sparrow: ${pack.links.gatekeeper}`,
    `- ThumbGate + Gatekeeper comparison: ${pack.links.thumbgateGatekeeperCompare}`,
    '',
    '## Reusable Evaluation Assets',
    '',
    ...assetLines,
    '## Unknowns',
    '',
    ...pack.unknowns.map((unknown) => `- ${unknown}`),
    '',
  ].join('\n');
}

function renderOffer(pack) {
  return [
    '# Human-on-the-Bridge Workflow Hardening Sprint',
    '',
    `Generated: \`${pack.generatedAt}\``,
    '',
    '## Offer',
    '',
    `- Name: ${pack.offer.name}`,
    `- Positioning: ${pack.offer.positioning}`,
    `- Buyer: ${pack.offer.buyer}`,
    `- CTA: ${pack.offer.callToAction}`,
    '',
    '## Scope',
    '',
    ...pack.offer.scope.map((item) => `- ${item}`),
    '',
    '## Gatekeeper Field Fit',
    '',
    '- Gatekeeper covers the workforce-input boundary before regulated data leaves the building.',
    '- ThumbGate covers the agent-action boundary before coding agents execute risky tool calls.',
    '- The HOB framing explains why both are stronger when expert judgment becomes reusable proof before execution.',
    `- Gatekeeper link: ${pack.links.gatekeeper}`,
    `- ThumbGate link: ${pack.links.thumbgate}`,
    '',
    '## Commercial Guardrail',
    '',
    pack.offer.commercialGuardrail,
    '',
  ].join('\n');
}

function renderContentQueue(pack) {
  return [
    '# HOB ThumbGate Content Approval Queue',
    '',
    `Generated: \`${pack.generatedAt}\``,
    '',
    'Do not publish from this file without action-time approval.',
    '',
    `Publishing approval phrase: \`${APPROVAL_PHRASE}\``,
    '',
    ...pack.contentQueue.flatMap((entry) => ([
      `## ${entry.platform}`,
      '',
      `- Status: ${entry.status}`,
      `- Purpose: ${entry.purpose}`,
      `- Required links: ${entry.requiredLinks.join(', ')}`,
      `- Approval: \`${entry.approval}\``,
      '',
      entry.title ? `Title: ${entry.title}\n` : '',
      entry.outline ? entry.outline.map((line) => `- ${line}`).join('\n') : '```text\n' + entry.text + '\n```',
      '',
    ])),
  ].join('\n');
}

function renderOutreachQueue(pack) {
  return [
    '# HOB ThumbGate Outreach Approval Queue',
    '',
    `Generated: \`${pack.generatedAt}\``,
    '',
    'Do not send any message from this file without action-time approval.',
    '',
    ...pack.outreachQueue.flatMap((entry) => ([
      `## ${entry.target}`,
      '',
      `- Channel: ${entry.channel}`,
      `- Score: ${entry.score}`,
      `- Reason: ${entry.reason}`,
      `- Evidence: ${entry.evidence.join(', ')}`,
      `- Proposed action: ${entry.proposedAction}`,
      `- Approval: \`${entry.approval}\``,
      '',
      '```text',
      entry.draft,
      '```',
      '',
    ])),
  ].join('\n');
}

function buildArtifacts(pack) {
  return {
    'EVIDENCE_LEDGER.md': renderEvidenceLedger(pack),
    'HOB_PACK.md': renderHobPack(pack),
    'HOB_REVENUE_SPRINT.md': renderOffer(pack),
    [`HOB_CONTENT_QUEUE_${pack.date}.md`]: renderContentQueue(pack),
    'HOB_OUTREACH_QUEUE.md': renderOutreachQueue(pack),
    'hob-pack.json': `${JSON.stringify(pack, null, 2)}\n`,
  };
}

function writeHobArtifacts(pack, options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const reportDir = options.reportDir
    ? path.resolve(repoRoot, options.reportDir)
    : path.join(repoRoot, 'reports', 'gtm', `${pack.date}-${REPORT_SLUG}`);
  const artifacts = buildArtifacts(pack);

  fs.mkdirSync(reportDir, { recursive: true });
  const files = [];
  for (const [filename, content] of Object.entries(artifacts)) {
    const filepath = path.join(reportDir, filename);
    fs.writeFileSync(filepath, content);
    files.push(filepath);
  }

  return { reportDir, files };
}

function parseArgs(argv = []) {
  const options = {
    write: false,
    reportDir: '',
    date: DEFAULT_DATE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write' || arg === '--write-docs') {
      options.write = true;
      continue;
    }
    if (arg === '--date') {
      options.date = normalizeText(argv[index + 1]) || options.date;
      index += 1;
      continue;
    }
    if (arg.startsWith('--date=')) {
      options.date = normalizeText(arg.split(/=(.*)/s)[1]) || options.date;
      continue;
    }
    if (arg === '--report-dir') {
      options.reportDir = normalizeText(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--report-dir=')) {
      options.reportDir = normalizeText(arg.split(/=(.*)/s)[1]);
    }
  }

  return options;
}

function run(argv = process.argv.slice(2), repoRoot = REPO_ROOT) {
  const options = parseArgs(argv);
  const evidence = collectLocalEvidence(repoRoot);
  const pack = buildHobPack({
    date: options.date,
    generatedAt: evidence.generatedAt,
    evidence,
  });

  if (options.write) {
    const result = writeHobArtifacts(pack, {
      repoRoot,
      reportDir: options.reportDir,
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      reportDir: result.reportDir,
      files: result.files,
      approvalPhrase: APPROVAL_PHRASE,
    }, null, 2)}\n`);
    return result;
  }

  process.stdout.write(renderHobPack(pack));
  return pack;
}

if (require.main === module) {
  run();
}

module.exports = {
  APPROVAL_PHRASE,
  OUTREACH_APPROVAL_PHRASE,
  LINKS,
  buildArtifacts,
  buildContentQueue,
  buildHobPack,
  buildOutreachQueue,
  collectLocalEvidence,
  parseArgs,
  renderContentQueue,
  renderEvidenceLedger,
  renderHobPack,
  renderOffer,
  renderOutreachQueue,
  run,
  writeHobArtifacts,
};
