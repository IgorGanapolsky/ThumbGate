#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  COMMERCIAL_TRUTH_LINK,
  VERIFICATION_EVIDENCE_LINK,
  buildRevenueLinks,
} = require('./gtm-revenue-loop');
const {
  buildTrackedPackLink,
  csvCell,
  isCliInvocation,
  parseReportArgs,
  writeRevenuePackArtifacts,
} = require('./revenue-pack-utils');
const { ensureDir } = require('./fs-utils');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_PATH = path.join(REPO_ROOT, 'docs', 'marketing', 'local-first-ai-reliability-pack.md');
const PUBLIC_GUIDE_PATH = path.join(REPO_ROOT, 'public', 'guides', 'local-first-ai-agent-reliability.html');
const DOC_GUIDE_PATH = path.join(REPO_ROOT, 'docs', 'guides', 'local-first-ai-agent-reliability.md');
const SOURCE = Object.freeze({
  url: 'https://www.infoq.com/articles/local-first-ai-inference-cloud/',
  title: 'Local-First AI Inference: A Cloud Architecture Pattern for Cost-Effective Document Processing',
  observedAt: '2026-05-13',
});
const TRACKING_DEFAULTS = Object.freeze({
  utmSource: 'infoq',
  utmMedium: 'organic_ai_architecture',
  utmCampaign: 'local_first_ai_reliability',
  utmContent: 'guide',
  surface: 'local_first_ai_reliability',
});
const PROOF_LINKS = [COMMERCIAL_TRUTH_LINK, VERIFICATION_EVIDENCE_LINK];
const GUIDE_SLUG = 'local-first-ai-agent-reliability';
const GUIDE_URL = `https://thumbgate.ai/guides/${GUIDE_SLUG}`;

function trackedLink(baseUrl, tracking = {}) {
  return buildTrackedPackLink(baseUrl, tracking, TRACKING_DEFAULTS);
}

function buildTrackedCtas(links = buildRevenueLinks()) {
  return {
    guide: trackedLink(`${links.appOrigin}/guides/${GUIDE_SLUG}`, {
      utmContent: 'public_guide',
      campaignVariant: 'seo_geo_guide',
      offerCode: 'LOCAL-FIRST_GUIDE',
      ctaId: 'local_first_guide',
      ctaPlacement: 'guide_body',
    }),
    installGuide: trackedLink(links.guideLink, {
      utmContent: 'install_guide',
      campaignVariant: 'free_install',
      offerCode: 'LOCAL-FIRST_INSTALL',
      ctaId: 'local_first_install',
      ctaPlacement: 'guide_sidebar',
    }),
    pro: trackedLink(links.proCheckoutLink, {
      utmContent: 'pro_checkout',
      campaignVariant: 'self_serve_pro',
      offerCode: 'LOCAL-FIRST_PRO',
      ctaId: 'local_first_pro',
      ctaPlacement: 'guide_sidebar',
      planId: 'pro',
    }),
    sprint: trackedLink(links.sprintLink, {
      utmContent: 'workflow_sprint',
      campaignVariant: 'qualified_sprint',
      offerCode: 'LOCAL-FIRST_SPRINT',
      ctaId: 'local_first_sprint',
      ctaPlacement: 'guide_body',
    }),
  };
}

function buildArchitectureTiers(ctas = buildTrackedCtas()) {
  return [
    {
      tier: 'Tier 1',
      name: 'Local deterministic gates',
      owner: 'ThumbGate public shell',
      action: 'Run local policy, memory, allowlist, denylist, and proof checks before a tool call or completion claim.',
      successMetric: 'local_gate_pass_rate',
      escalationRule: 'Escalate only when the action is ambiguous, novel, or high blast-radius.',
      cta: ctas.installGuide,
    },
    {
      tier: 'Tier 2',
      name: 'Model-assisted review path',
      owner: 'private core or external reviewer',
      action: 'Use retrieval, reranking, or an LLM judge only for uncertain actions that local rules cannot confidently classify.',
      successMetric: 'model_escalation_precision',
      escalationRule: 'Require structured evidence and reject unsupported claims instead of retrying the same hallucinated answer.',
      cta: ctas.pro,
    },
    {
      tier: 'Tier 3',
      name: 'Human approval queue',
      owner: 'operator or team reviewer',
      action: 'Route production, billing, security, and broad write actions to human review when confidence is low or evidence conflicts.',
      successMetric: 'human_review_escape_rate',
      escalationRule: 'Do not let uncertain actions auto-execute; require explicit approval or a smaller scoped action.',
      cta: ctas.sprint,
    },
  ];
}

function buildGateChecklist() {
  return [
    {
      id: 'model_call_necessity_gate',
      label: 'Model-call necessity gate',
      rule: 'Ask whether the action needs a model at all before spending tokens or trusting a generated judgment.',
      buyerPain: 'cloud AI cost, slow agent loops, and unnecessary exposure of local workflow state',
    },
    {
      id: 'confidence_threshold_gate',
      label: 'Confidence threshold gate',
      rule: 'Route high-confidence local matches to execution, medium-confidence actions to model review, and low-confidence actions to human approval.',
      buyerPain: 'silent hallucination risk and no clear escalation path',
    },
    {
      id: 'task_specific_eval_gate',
      label: 'Task-specific eval gate',
      rule: 'Evaluate model upgrades against the exact workflow failure set, not vendor leaderboard claims.',
      buyerPain: 'expensive migrations that do not improve the actual agent task',
    },
    {
      id: 'prompt_change_regression_gate',
      label: 'Prompt change regression gate',
      rule: 'Treat production prompts as engineering artifacts with error-class history, regression checks, and rollback evidence.',
      buyerPain: 'prompt tweaks that fix one failure while reopening old repeated mistakes',
    },
    {
      id: 'human_review_boundary_gate',
      label: 'Human review boundary gate',
      rule: 'Require human approval for conflicting evidence, low confidence, or actions that touch production, billing, secrets, or public claims.',
      buyerPain: 'unbounded autonomous-agent blast radius',
    },
  ];
}

function buildBuyerSegments(ctas = buildTrackedCtas()) {
  return [
    {
      segment: 'DevEx teams',
      intent: 'reduce wasted model calls while keeping AI coding agents fast',
      offer: 'Free install guide, then Pro when they need dashboards and proof exports',
      cta: ctas.installGuide,
    },
    {
      segment: 'Platform and security teams',
      intent: 'bound autonomous-agent errors with local controls and review queues',
      offer: 'Workflow Hardening Sprint for one repeated risky action',
      cta: ctas.sprint,
    },
    {
      segment: 'AI infra buyers',
      intent: 'evaluate model upgrades using task-specific validation instead of benchmark marketing',
      offer: 'Pro plus a validation checklist tied to real rejected actions',
      cta: ctas.pro,
    },
  ];
}

function buildMeasurementPlan() {
  return {
    northStar: 'local_first_guide_to_verified_paid_intent',
    policy: 'Count success only when the local-first guide produces install intent, Pro checkout start, qualified sprint intake, or verified non-operator customer revenue.',
    metrics: [
      'local_first_guide_view',
      'install_guide_click',
      'local_first_pro_checkout_start',
      'workflow_sprint_intake',
      'qualified_local_first_reply',
      'verified_customer_revenue',
    ],
    guardrails: [
      'Do not claim ThumbGate reduced cloud AI spend for a customer without evidence.',
      'Do not claim local gates replace human review for high-risk actions.',
      'Do not claim verified customer revenue from operator/test Stripe payments.',
      'Do not turn architecture commentary into unsupported product performance claims.',
    ],
    doNotCountAsSuccess: [
      'pageviews without CTA clicks',
      'social impressions without replies or tracked sessions',
      'operator/test Stripe payments',
      'checkout starts without customer provenance',
      'model-cost claims without workflow-specific measurements',
    ],
  };
}

function buildOperatorQueue(ctas = buildTrackedCtas()) {
  return [
    {
      key: 'publish_local_first_guide',
      audience: 'AI infra and DevEx buyers',
      evidence: SOURCE.url,
      proofAsset: GUIDE_URL,
      nextAsk: 'Ship the local-first guide and route readers to install guide, Pro, or Workflow Hardening Sprint based on risk.',
      recommendedMotion: 'SEO/GEO acquisition',
    },
    {
      key: 'post_linkedin_architecture_commentary',
      audience: 'LinkedIn engineering leaders',
      evidence: SOURCE.url,
      proofAsset: ctas.guide,
      nextAsk: 'Post architecture commentary that frames ThumbGate as local deterministic gates before model escalation.',
      recommendedMotion: 'Founder-led discovery, no fake customer claims',
    },
    {
      key: 'reply_to_local_first_threads',
      audience: 'Reddit, Hacker News, and community threads about local AI cost and privacy',
      evidence: SOURCE.url,
      proofAsset: ctas.installGuide,
      nextAsk: 'Reply only where the thread asks about AI agent reliability, cloud model cost, or human-in-the-loop boundaries.',
      recommendedMotion: 'Guide-first self-serve',
    },
    {
      key: 'route_repeated_failure_to_sprint',
      audience: 'Teams with one named repeated autonomous-agent failure',
      evidence: VERIFICATION_EVIDENCE_LINK,
      proofAsset: ctas.sprint,
      nextAsk: 'Offer a workflow hardening sprint only after the buyer names a concrete repeated failure and blast radius.',
      recommendedMotion: 'Qualified sprint intake',
    },
  ];
}

function buildChannelDrafts(ctas = buildTrackedCtas()) {
  return [
    {
      id: 'linkedin_local_first_architecture',
      channel: 'LinkedIn',
      audience: 'DevEx and platform leaders',
      cta: ctas.guide,
      draft: `The useful AI architecture question is not always "which model?" It is "should this action reach a model at all?" ThumbGate applies that local-first pattern to AI agents: local deterministic gates first, model review only for ambiguous actions, human approval for high-risk changes. Guide: ${ctas.guide}`,
      guardrail: 'Do not claim customer cost savings or verified revenue.',
    },
    {
      id: 'reddit_local_first_reply',
      channel: 'Reddit',
      audience: 'Developers discussing local AI and cloud inference cost',
      cta: ctas.installGuide,
      draft: `This local-first pattern maps well to coding agents too. Run deterministic checks locally first, escalate uncertain actions to model review, and require human approval for high-risk writes. I wrote up the ThumbGate version here: ${ctas.installGuide}`,
      guardrail: 'Only post as a relevant reply, not as a cold promotion.',
    },
    {
      id: 'sprint_qualified_followup',
      channel: 'Manual follow-up',
      audience: 'Teams with repeated AI-agent workflow failures',
      cta: ctas.sprint,
      draft: `If you already have one repeated agent failure, the practical fix is a local-first gate before the next risky action. We can scope one workflow, capture the rejected behavior, add the pre-action gate, and prove the next run. Intake: ${ctas.sprint}`,
      guardrail: 'Use only after concrete pain is confirmed.',
    },
  ];
}

function buildLocalFirstAiReliabilityPack(links = buildRevenueLinks()) {
  const ctas = buildTrackedCtas(links);
  return {
    generatedAt: new Date().toISOString(),
    name: 'thumbgate-local-first-ai-reliability-pack',
    status: 'guide-ready-no-revenue-claim',
    source: SOURCE,
    headline: 'Local-first AI reliability gates before cloud or agent execution',
    shortDescription: 'ThumbGate turns local-first AI inference into a buyer-ready agent reliability story: deterministic local gates first, model review for uncertain actions, and human approval for high-risk changes.',
    objective: 'Capture demand from AI infrastructure, DevEx, and security buyers who care about cloud AI cost, local control, and bounded autonomous-agent errors.',
    ctas,
    architectureTiers: buildArchitectureTiers(ctas),
    gateChecklist: buildGateChecklist(),
    buyerSegments: buildBuyerSegments(ctas),
    measurementPlan: buildMeasurementPlan(),
    operatorQueue: buildOperatorQueue(ctas),
    channelDrafts: buildChannelDrafts(ctas),
    proofLinks: PROOF_LINKS,
  };
}

function renderRows(rows) {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function renderOperatorQueueCsv(queue = []) {
  return renderRows([
    ['key', 'audience', 'evidence', 'proofAsset', 'nextAsk', 'recommendedMotion'],
    ...queue.map((entry) => [
      entry.key,
      entry.audience,
      entry.evidence,
      entry.proofAsset,
      entry.nextAsk,
      entry.recommendedMotion,
    ]),
  ]);
}

function renderChannelDraftsCsv(drafts = []) {
  return renderRows([
    ['id', 'channel', 'audience', 'cta', 'draft', 'guardrail'],
    ...drafts.map((draft) => [
      draft.id,
      draft.channel,
      draft.audience,
      draft.cta,
      draft.draft,
      draft.guardrail,
    ]),
  ]);
}

function renderMarkdown(pack = {}) {
  const lines = [
    '# Local-First AI Reliability Pack',
    '',
    `Updated: ${pack.generatedAt}`,
    '',
    `Status: ${pack.status}`,
    '',
    pack.shortDescription,
    '',
    '## Source',
    `- ${pack.source.title}: ${pack.source.url}`,
    `- Observed: ${pack.source.observedAt}`,
    '',
    '## Objective',
    pack.objective,
    '',
    '## Tracked CTAs',
    `- Public guide: ${pack.ctas.guide}`,
    `- Install guide: ${pack.ctas.installGuide}`,
    `- Pro: ${pack.ctas.pro}`,
    `- Sprint: ${pack.ctas.sprint}`,
    '',
    '## Three-Tier Architecture',
    ...pack.architectureTiers.map((tier) => [
      `### ${tier.tier}: ${tier.name}`,
      `- Owner: ${tier.owner}`,
      `- Action: ${tier.action}`,
      `- Success metric: ${tier.successMetric}`,
      `- Escalation rule: ${tier.escalationRule}`,
      `- CTA: ${tier.cta}`,
      '',
    ].join('\n')),
    '## Pre-Action Gates',
    ...pack.gateChecklist.map((gate) => `- ${gate.label}: ${gate.rule} Buyer pain: ${gate.buyerPain}`),
    '',
    '## Buyer Segments',
    ...pack.buyerSegments.map((segment) => `- ${segment.segment}: ${segment.intent}. Offer: ${segment.offer}. CTA: ${segment.cta}`),
    '',
    '## Measurement',
    `- North star: ${pack.measurementPlan.northStar}`,
    `- Policy: ${pack.measurementPlan.policy}`,
    'Metrics:',
    ...pack.measurementPlan.metrics.map((metric) => `- ${metric}`),
    'Guardrails:',
    ...pack.measurementPlan.guardrails.map((guardrail) => `- ${guardrail}`),
    'Do not count as success:',
    ...pack.measurementPlan.doNotCountAsSuccess.map((item) => `- ${item}`),
    '',
    '## Operator Queue',
    ...pack.operatorQueue.map((entry) => [
      `### ${entry.audience}`,
      `- Evidence: ${entry.evidence}`,
      `- Proof asset: ${entry.proofAsset}`,
      `- Next ask: ${entry.nextAsk}`,
      `- Recommended motion: ${entry.recommendedMotion}`,
      '',
    ].join('\n')),
    '## Channel Drafts',
    ...pack.channelDrafts.map((draft) => [
      `### ${draft.channel}: ${draft.audience}`,
      draft.draft,
      `Guardrail: ${draft.guardrail}`,
      '',
    ].join('\n')),
    '## Proof Links',
    ...pack.proofLinks.map((link) => `- ${link}`),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function renderDocGuideMarkdown(pack = {}) {
  return [
    '# Local-First AI Agent Reliability',
    '',
    `Source trigger: ${pack.source.url}`,
    '',
    'The high-ROI lesson is simple: do not route every agent action to a model. Run local deterministic gates first, escalate ambiguous actions to model review, and require human approval for risky writes.',
    '',
    '## ThumbGate Mapping',
    ...pack.architectureTiers.map((tier) => `- ${tier.name}: ${tier.action}`),
    '',
    '## Buyer CTA',
    `- Install guide: ${pack.ctas.installGuide}`,
    `- Workflow Hardening Sprint: ${pack.ctas.sprint}`,
    '',
    '## Measurement Rule',
    pack.measurementPlan.policy,
    '',
  ].join('\n');
}

function renderPublicGuideHtml(pack = {}) {
  const techArticle = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: 'Local-First AI Agent Reliability',
    description: pack.shortDescription,
    about: [
      'local-first AI inference',
      'AI agent guardrails',
      'confidence-gated routing',
      'human-in-the-loop AI',
      'pre-action gates',
    ],
    url: GUIDE_URL,
    publisher: {
      '@type': 'Organization',
      name: 'ThumbGate',
      url: 'https://thumbgate.ai',
    },
    mainEntityOfPage: GUIDE_URL,
  };
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'What does local-first AI mean for coding agents?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'It means deterministic local checks run before model review or risky execution. ThumbGate uses pre-action gates to block known-bad agent actions before they repeat.',
        },
      },
      {
        '@type': 'Question',
        name: 'Does ThumbGate replace human review?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'No. ThumbGate routes high-risk or low-confidence actions to human approval instead of letting uncertain agent work auto-execute.',
        },
      },
    ],
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Local-First AI Agent Reliability | ThumbGate</title>
  <meta name="description" content="${pack.shortDescription}" />
  <meta property="og:title" content="Local-First AI Agent Reliability | ThumbGate" />
  <meta property="og:description" content="${pack.shortDescription}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${GUIDE_URL}" />
  <link rel="canonical" href="${GUIDE_URL}" />
  <link rel="llm-context" href="/public/llm-context.md" type="text/markdown" />
  <link rel="icon" type="image/svg+xml" href="/thumbgate-icon.png" />
  <link rel="apple-touch-icon" href="/assets/brand/thumbgate-mark.svg" />
  <meta property="og:image" content="/og.png" />
  <style>
    :root { --bg: #0a0a0b; --panel: #151518; --line: #25252a; --text: #ededf2; --muted: #a2a2ad; --cyan: #22d3ee; --green: #4ade80; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); line-height: 1.65; }
    a { color: var(--cyan); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .container { max-width: 1040px; margin: 0 auto; padding: 0 24px; }
    .topbar { position: sticky; top: 0; z-index: 10; border-bottom: 1px solid var(--line); background: rgba(10, 10, 11, 0.88); backdrop-filter: blur(12px); }
    .topbar .container { display: flex; justify-content: space-between; align-items: center; padding-top: 14px; padding-bottom: 14px; }
    .brand { display: inline-flex; align-items: center; gap: 8px; color: var(--text); font-weight: 700; }
    .brand img { width: 28px; height: 28px; }
    .hero { padding: 72px 0 28px; }
    .eyebrow { color: var(--cyan); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
    h1 { max-width: 820px; margin: 14px 0; font-size: clamp(34px, 5vw, 58px); line-height: 1.06; letter-spacing: 0; }
    .hero p { max-width: 760px; color: var(--muted); font-size: 18px; }
    .grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); gap: 24px; padding: 28px 0 72px; }
    .section, .sidebar-card { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 24px; }
    .section { margin-bottom: 18px; }
    .section h2, .sidebar-card h2 { margin-top: 0; letter-spacing: 0; }
    .section p, .section li, .sidebar-card li, .sidebar-card p { color: var(--muted); }
    .pill-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
    .pill { border: 1px solid var(--line); border-radius: 999px; padding: 8px 12px; background: #101013; font-size: 14px; }
    .cta { display: inline-flex; justify-content: center; align-items: center; min-height: 44px; margin-top: 14px; padding: 10px 14px; border-radius: 8px; background: var(--cyan); color: #071116; font-weight: 700; }
    code { color: var(--green); background: #101013; border: 1px solid var(--line); border-radius: 6px; padding: 2px 5px; }
    .sidebar { display: flex; flex-direction: column; gap: 18px; }
    .sidebar-card:first-child { position: sticky; top: 84px; }
    details { border-top: 1px solid var(--line); padding: 14px 0; }
    summary { cursor: pointer; font-weight: 700; }
    @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } .sidebar-card:first-child { position: static; } }
  </style>
  <script type="application/ld+json">${JSON.stringify(techArticle, null, 2)}</script>
  <script type="application/ld+json">${JSON.stringify(faq, null, 2)}</script>
</head>
<body>
  <div class="topbar">
    <div class="container">
      <a class="brand" href="/"><img src="/assets/brand/thumbgate-mark-inline.svg" alt="ThumbGate"><span>ThumbGate</span></a>
      <a href="${VERIFICATION_EVIDENCE_LINK}" target="_blank" rel="noopener">Verification evidence</a>
    </div>
  </div>
  <main class="container">
    <section class="hero">
      <div class="eyebrow">Guide | local-first AI reliability</div>
      <h1>Run local AI agent gates before cloud review or risky execution.</h1>
      <p>${pack.shortDescription}</p>
      <div class="pill-row">
        <span class="pill">Local deterministic gates first</span>
        <span class="pill">Model review only when uncertain</span>
        <span class="pill">Human approval for high-risk actions</span>
      </div>
    </section>
    <section class="grid">
      <div>
        <section class="section">
          <h2>Why this matters</h2>
          <p>The useful architecture question is not only which model to use. It is whether the action should reach a model at all. ThumbGate applies that local-first pattern to AI coding agents by checking rejected actions, proof requirements, and risky tool calls before execution.</p>
        </section>
        <section class="section">
          <h2>The three-tier reliability path</h2>
          <ul>
            ${pack.architectureTiers.map((tier) => `<li><strong>${tier.name}:</strong> ${tier.action}</li>`).join('\n            ')}
          </ul>
        </section>
        <section class="section">
          <h2>Pre-action gates to enable</h2>
          <ul>
            ${pack.gateChecklist.map((gate) => `<li><strong>${gate.label}:</strong> ${gate.rule}</li>`).join('\n            ')}
          </ul>
        </section>
        <section class="section">
          <h2>CLI path</h2>
          <p>Start local. Capture the rejected behavior, generate the rule, then test the gate before trusting another autonomous run.</p>
          <p><code>npx thumbgate init</code></p>
          <p><code>npm run feedback:rules</code></p>
          <p><code>npm run self-heal:check</code></p>
        </section>
        <section class="section">
          <h2>Where this creates revenue</h2>
          <p>This guide targets buyers who already understand local-first AI, cloud inference cost, and human review boundaries. The commercial path is honest: free install for self-serve operators, Pro at $19/mo or $149/yr when they need dashboards and exports, and Team rollout at $49/seat/mo after a qualified workflow risk is named.</p>
          <a class="cta" href="${pack.ctas.sprint}">Scope one risky workflow</a>
        </section>
        <section class="section">
          <h2>FAQ</h2>
          <details>
            <summary>What does local-first AI mean for coding agents?</summary>
            <p>It means deterministic local checks run before model review or risky execution. ThumbGate uses Pre-Action Gates to block known-bad agent actions before they repeat.</p>
          </details>
          <details>
            <summary>Does ThumbGate replace human review?</summary>
            <p>No. ThumbGate routes high-risk or low-confidence actions to human approval instead of letting uncertain agent work auto-execute.</p>
          </details>
        </section>
      </div>
      <aside class="sidebar">
        <div class="sidebar-card">
          <h2>Start here</h2>
          <p>Install the local-first Reliability Gateway, then upgrade only when the workflow needs dashboards, exports, or team gates.</p>
          <a class="cta" href="${pack.ctas.installGuide}">Open install guide</a>
          <a class="cta" href="${pack.ctas.pro}">Open Pro checkout</a>
        </div>
        <div class="sidebar-card">
          <h2>Proof boundaries</h2>
          <ul>
            <li>No customer cost-saving claim without evidence.</li>
            <li>No verified revenue claim from operator/test payments.</li>
            <li>No claim that local gates replace human approval.</li>
          </ul>
        </div>
      </aside>
    </section>
  </main>
</body>
</html>
`;
}

function writeLocalFirstAiReliabilityPack(pack, options = {}) {
  const written = writeRevenuePackArtifacts({
    repoRoot: REPO_ROOT,
    docsPath: DOCS_PATH,
    reportDir: options.reportDir,
    writeDocs: options.writeDocs,
    markdown: renderMarkdown(pack),
    jsonName: 'local-first-ai-reliability-pack.json',
    jsonValue: pack,
    csvArtifacts: [
      { name: 'local-first-ai-reliability-operator-queue.csv', value: renderOperatorQueueCsv(pack.operatorQueue) },
      { name: 'local-first-ai-reliability-channel-drafts.csv', value: renderChannelDraftsCsv(pack.channelDrafts) },
    ],
  });

  if (options.writeDocs) {
    ensureDir(path.dirname(PUBLIC_GUIDE_PATH));
    ensureDir(path.dirname(DOC_GUIDE_PATH));
    fs.writeFileSync(PUBLIC_GUIDE_PATH, renderPublicGuideHtml(pack), 'utf8');
    fs.writeFileSync(DOC_GUIDE_PATH, renderDocGuideMarkdown(pack), 'utf8');
  }

  if (options.reportDir) {
    const reportDir = path.resolve(REPO_ROOT, options.reportDir);
    fs.writeFileSync(path.join(reportDir, path.basename(PUBLIC_GUIDE_PATH)), renderPublicGuideHtml(pack), 'utf8');
    fs.writeFileSync(path.join(reportDir, path.basename(DOC_GUIDE_PATH)), renderDocGuideMarkdown(pack), 'utf8');
  }

  return {
    ...written,
    publicGuidePath: options.writeDocs ? PUBLIC_GUIDE_PATH : null,
    docGuidePath: options.writeDocs ? DOC_GUIDE_PATH : null,
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  return parseReportArgs(argv);
}

function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pack = buildLocalFirstAiReliabilityPack();
  const written = writeLocalFirstAiReliabilityPack(pack, options);
  if (!options.writeDocs && !options.reportDir) {
    process.stdout.write(renderMarkdown(pack));
  } else {
    process.stdout.write(`Wrote local-first AI reliability pack${written.docsPath ? ` to ${written.docsPath}` : ''}\n`);
  }
  return written;
}

if (isCliInvocation(process.argv, __filename)) {
  run();
}

module.exports = {
  GUIDE_SLUG,
  SOURCE,
  buildArchitectureTiers,
  buildBuyerSegments,
  buildChannelDrafts,
  buildGateChecklist,
  buildLocalFirstAiReliabilityPack,
  buildMeasurementPlan,
  buildOperatorQueue,
  buildTrackedCtas,
  renderChannelDraftsCsv,
  renderDocGuideMarkdown,
  renderMarkdown,
  renderOperatorQueueCsv,
  renderPublicGuideHtml,
  run,
  trackedLink,
  writeLocalFirstAiReliabilityPack,
};
