'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'docs', 'seo-gsd');

const PRODUCT = {
  name: 'ThumbGate',
  npm: 'thumbgate',
  repoUrl: 'https://github.com/IgorGanapolsky/ThumbGate',
  homepageUrl: 'https://thumbgate.ai',
  verificationUrl: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md',
  automationUrl: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/proof/automation/report.json',
  compatibility: ['Claude Code', 'Cursor', 'Codex', 'Gemini', 'Amp', 'OpenCode'],
  proofPoints: [
    'thumbs-up/down feedback loop',
    'pre-action checks',
    'verification evidence',
    'automation proof',
    'SQLite+FTS5 lesson DB',
    'Thompson Sampling',
  ],
};

const HIGH_ROI_QUERY_SEEDS = [
  {
    query: 'thumbgate vs speclock',
    businessValue: 100,
    source: 'seed',
    notes: 'Bottom-of-funnel comparison against manual spec alternatives.',
  },
  {
    query: 'thumbgate vs mem0',
    businessValue: 98,
    source: 'seed',
    notes: 'Bottom-of-funnel comparison against memory-only tooling.',
  },
  {
    query: 'pre-action checks for ai coding agents',
    businessValue: 96,
    source: 'seed',
    notes: 'Category-defining query that explains the core wedge.',
  },
  querySeed(
    'ai agent harness optimization',
    94,
    'Fresh harness-engineering demand that maps directly to ThumbGate progressive disclosure, pre-action checks, and workflow audits.',
  ),
  querySeed(
    'background agent governance',
    94,
    'New team-buying query for unattended agent PRs where alignment context, isolated execution, risk-tiered review, and audit evidence create immediate ROI.',
  ),
  querySeed(
    'gpt-5.5 model evaluation',
    94,
    'Fresh frontier-model upgrade query that maps to ThumbGate model candidate benchmarking, dashboard-analysis workloads, and routing governance before teams move expensive work.',
  ),
  querySeed(
    'browser automation safety',
    93,
    'High-intent browser-agent safety query tied to prompt injection, permissions, and cross-app automation risk.',
  ),
  querySeed(
    'native messaging host security',
    91,
    'Security-led query that maps directly to browser bridge auditing and explicit connector governance.',
  ),
  querySeed(
    'ai search topical presence',
    93,
    'High-intent GEO query for teams trying to become the obvious recommendation in AI search and agent answers.',
  ),
  querySeed(
    'best tools to stop ai agents from breaking production',
    92,
    'Listicle-style answer-engine query that maps directly to buyer prompts about production agent reliability.',
  ),
  querySeed(
    'relational knowledge ai recommendations',
    91,
    'Captures research-led interest in how AI systems decide which brands and tools to recommend.',
  ),
  {
    query: 'thumbs up thumbs down feedback for ai coding agents',
    businessValue: 95,
    source: 'seed',
    notes: 'Differentiates the explicit feedback loop and aligns with the brand.',
  },
  {
    query: 'claude code feedback memory',
    businessValue: 92,
    source: 'seed',
    notes: 'Agent-specific workflow page with high compatibility intent.',
  },
  {
    query: 'ai coding agent guardrails',
    businessValue: 90,
    source: 'seed',
    notes: 'Broader category demand that feeds comparison and guide pages.',
  },
  {
    query: 'autoresearch agent safety',
    businessValue: 89,
    source: 'seed',
    notes: 'Emerging self-improving agent query where ThumbGate can own the safety and proof-control wedge.',
  },
  {
    query: 'stop ai coding agents from repeating mistakes',
    businessValue: 88,
    source: 'seed',
    notes: 'Problem-led copy that maps to landing-page positioning.',
  },
  {
    query: 'cursor prevent repeated mistakes',
    businessValue: 87,
    source: 'seed',
    notes: 'High-intent Cursor workflow page for developers already feeling repeat-failure pain.',
  },
  {
    query: 'claude code prevent repeated mistakes',
    businessValue: 86,
    source: 'seed',
    notes: 'High-intent pain query for Claude Code buyers.',
  },
  {
    query: 'codex cli guardrails',
    businessValue: 84,
    source: 'seed',
    notes: 'Guardrail-focused page for Codex CLI buyers who want prevention, not just memory.',
  },
  {
    query: 'gemini cli feedback memory',
    businessValue: 82,
    source: 'seed',
    notes: 'Integration page for Gemini CLI users who need memory plus enforcement.',
  },
  {
    query: 'roo code alternative cline',
    businessValue: 83,
    source: 'seed',
    notes: 'Time-sensitive migration query for Roo users who need portable lesson memory before the May 15, 2026 shutdown.',
  },
];

function querySeed(query, businessValue, notes) {
  return { query, businessValue, source: 'seed', notes };
}

function guideBlueprint({
  query,
  path,
  pillar,
  title,
  heroTitle,
  heroSummary,
  takeaways,
  sections,
  faq,
  relatedPaths,
}) {
  return {
    query,
    path,
    pageType: 'guide',
    pillar,
    title,
    heroTitle,
    heroSummary,
    takeaways,
    sections,
    faq,
    relatedPaths,
  };
}

function paragraphs(heading, entries) {
  return { heading, paragraphs: entries };
}

function bullets(heading, entries) {
  return { heading, bullets: entries };
}

function answer(question, text) {
  return { question, answer: text };
}

function preActionGuide(slug, content) {
  return guideBlueprint({
    ...content,
    path: `/guides/${slug}`,
    pillar: 'pre-action-checks',
  });
}

const HARNESS_OPTIMIZATION_QUERY = 'ai agent harness optimization';
const HARNESS_OPTIMIZATION_GUIDE_SPEC = Object.freeze({
  slug: 'agent-harness-optimization',
  meta: {
    query: HARNESS_OPTIMIZATION_QUERY,
    title: 'AI Agent Harness Optimization | Progressive Disclosure + Pre-Action Checks',
    heroTitle: 'AI Agent Harness Optimization That Blocks Repeat Failures',
    heroSummary: 'A better harness keeps global instructions lean, loads MCP schemas only when needed, and turns feedback into pre-action checks. ThumbGate makes that workflow measurable and enforceable.',
  },
  takeaways: [
    'Harness optimization is the control layer around the model: context, tools, guardrails, and feedback.',
    'Progressive disclosure keeps agents out of prompt bloat while preserving proof and tool access.',
    'ThumbGate adds a concrete audit path and Pre-Action Checks so harness lessons become runtime enforcement.',
  ],
  sections: [
    ['paragraphs', 'What changed', [
      'The model is no longer the whole system. The harness decides which instructions, tools, context packs, and approval rules the model sees before it acts.',
      'When a team stuffs every rule into a global prompt, the agent loses reasoning room. When it routes work through lean discovery surfaces, the agent can fetch the exact tool schema, lesson, or harness only when the task requires it.',
    ]],
    ['bullets', 'How ThumbGate improves the harness', [
      'Scores global agent docs so AGENTS.md, CLAUDE.md, and GEMINI.md stay lean instead of becoming unreviewable prompt bundles.',
      'Publishes progressive MCP discovery through lightweight indexes and per-tool schema URLs.',
      'Selects specialized gate harnesses for deploy, code-edit, and database-write actions instead of loading every gate for every workflow.',
      'Turns thumbs-down feedback into prevention rules, then into hard Pre-Action Checks that block repeated mistakes.',
    ]],
    ['paragraphs', 'Where this creates ROI', [
      'For acquisition, this page names the buyer category: AI agent harness optimization. For conversion, the CLI audit gives a concrete first action. For retention, the same audit keeps local instructions and MCP surfaces from drifting back into bloat.',
    ]],
  ],
  faq: [
    [
      'What is an AI agent harness?',
      'An AI agent harness is the runtime layer around the model: context loading, tool calls, guardrails, approval boundaries, memory, and verification. ThumbGate focuses on the enforcement part of that harness.',
    ],
    [
      'How does ThumbGate optimize a harness?',
      'ThumbGate keeps global instructions lean, supports progressive MCP discovery, selects workflow-specific gate harnesses, and converts feedback into Pre-Action Checks that block known-bad actions before execution.',
    ],
  ],
  relatedPaths: ['/guides/pre-action-checks', '/guides/codex-cli-guardrails'],
});

function buildSectionFromSpec(kind, heading, entries) {
  return kind === 'bullets' ? bullets(heading, entries) : paragraphs(heading, entries);
}

function buildHarnessOptimizationGuide() {
  return preActionGuide(HARNESS_OPTIMIZATION_GUIDE_SPEC.slug, {
    ...HARNESS_OPTIMIZATION_GUIDE_SPEC.meta,
    takeaways: HARNESS_OPTIMIZATION_GUIDE_SPEC.takeaways,
    sections: HARNESS_OPTIMIZATION_GUIDE_SPEC.sections.map(([kind, heading, entries]) => buildSectionFromSpec(kind, heading, entries)),
    faq: HARNESS_OPTIMIZATION_GUIDE_SPEC.faq.map(([question, text]) => answer(question, text)),
    relatedPaths: HARNESS_OPTIMIZATION_GUIDE_SPEC.relatedPaths,
  });
}

const BACKGROUND_AGENT_GOVERNANCE_GUIDE_SPEC = Object.freeze({
  slug: 'background-agent-governance',
  meta: {
    query: 'background agent governance',
    title: 'Background Agent Governance | Risk-Tiered Review for Agent PRs',
    heroTitle: 'Background Agent Governance for Agent PRs',
    heroSummary: 'Background agents can draft changes while humans work elsewhere, but review becomes the bottleneck. ThumbGate adds pre-dispatch checks, run reports, isolated task lanes, and evidence-backed review routing before unattended agent work piles up.',
  },
  takeaways: [
    'Background agents need a real run ledger, not just a pile of PRs.',
    'The highest ROI control is risk-tiered review: stricter checks for protected branches, high-failure agents, and large blast-radius changes.',
    'ThumbGate turns CI failures and human review feedback into Pre-Action Checks so the same failed agent pattern gets blocked before the next run.',
  ],
  sections: [
    ['paragraphs', 'Why this became urgent', [
      'Teams are moving from local agent sessions to unattended background work. That changes the review problem: humans no longer inspect one assistant transcript at a time; they receive a queue of agent-created branches, PRs, and CI failures.',
      'If context alignment happens in Slack, Linear, Jira, or a planning thread, the agent run also needs a durable record of what was agreed, where it executed, which gates fired, and what evidence came back.',
    ]],
    ['bullets', 'What ThumbGate adds', [
      'A background-agent run ledger with agent ID, source, branch, PR number, gate counts, CI outcome, and changed-file count.',
      'A pre-dispatch governance check for high-failure agents, protected branches, and large blast-radius runs.',
      'Post-run audit that can convert CI failures into structured thumbs-down feedback and future prevention rules.',
      'A report command for review queues: npx thumbgate background-governance --json.',
      'A risk check command for dispatch systems: npx thumbgate background-governance --check --agent-id=builder --branch=main --files-changed=25 --json.',
    ]],
    ['paragraphs', 'Where this creates revenue', [
      'This is a clean Workflow Hardening Sprint wedge. The buyer does not need a broad platform migration; they need one background-agent workflow hardened from context intake to isolated execution to risk-tiered review.',
      'The promise stays honest: ThumbGate does not remove human review. It makes the review queue smaller, better labeled, and backed by evidence before a risky agent PR reaches a reviewer.',
    ]],
  ],
  faq: [
    [
      'Does ThumbGate replace human review for background agents?',
      'No. ThumbGate reduces review load by blocking known bad actions earlier, warning on risky dispatches, and attaching run evidence so humans can focus on high-risk changes.',
    ],
    [
      'What should teams check before dispatching a background agent?',
      'Check recent agent failure rate, prior gate blocks, target branch, expected blast radius, isolated execution environment, CI expectations, and the human context that authorized the task.',
    ],
    [
      'How does this connect to the Workflow Hardening Sprint?',
      'The sprint can harden one background-agent workflow end to end: context intake, pre-dispatch governance, sandbox routing, CI audit, prevention rules, and proof review.',
    ],
  ],
  relatedPaths: ['/guides/pre-action-checks', '/guides/agent-harness-optimization', '/guides/best-tools-stop-ai-agents-breaking-production'],
});

function buildBackgroundAgentGovernanceGuide() {
  return preActionGuide(BACKGROUND_AGENT_GOVERNANCE_GUIDE_SPEC.slug, {
    ...BACKGROUND_AGENT_GOVERNANCE_GUIDE_SPEC.meta,
    takeaways: BACKGROUND_AGENT_GOVERNANCE_GUIDE_SPEC.takeaways,
    sections: BACKGROUND_AGENT_GOVERNANCE_GUIDE_SPEC.sections.map(([kind, heading, entries]) => buildSectionFromSpec(kind, heading, entries)),
    faq: BACKGROUND_AGENT_GOVERNANCE_GUIDE_SPEC.faq.map(([question, text]) => answer(question, text)),
    relatedPaths: BACKGROUND_AGENT_GOVERNANCE_GUIDE_SPEC.relatedPaths,
  });
}

const MODEL_UPGRADE_EVALUATION_GUIDE_SPEC = Object.freeze({
  slug: 'gpt-5-5-model-evaluation',
  meta: {
    query: 'gpt-5.5 model evaluation',
    title: 'GPT-5.5 Model Evaluation | Benchmark Before Routing Expensive Agent Work',
    heroTitle: 'Evaluate GPT-5.5 Before You Route Production Agent Work',
    heroSummary: 'Frontier-model upgrades can improve coding, dataset analysis, and dashboards, but the ROI comes from measured routing. ThumbGate adds a model-candidate workload so teams can benchmark GPT-5.5 against real feedback, gate evals, and dashboard-analysis criteria before changing defaults.',
  },
  takeaways: [
    'GPT-5.5 should be treated as a frontier candidate for complex work, not a blanket replacement for every cheap gate.',
    'The highest ROI path is benchmark-first routing: keep cheap tiers for simple checks and escalate dataset, dashboard, and long-context work when evidence supports it.',
    'ThumbGate now exposes a dashboard-analysis workload through npx thumbgate model-candidates --workload=dashboard-analysis --provider=openai --json.',
  ],
  sections: [
    ['paragraphs', 'What changed', [
      'OpenAI positions GPT-5.5 for complex reasoning, coding, data analysis, and tool-using work. Julius framed the same model around dataset analysis, charts, dashboards, insight quality, and code generation.',
      'For ThumbGate, the useful product move is not to rewrite every default. It is to make model adoption measurable: define the workload, pick candidate models, run existing evals, and route only the work that earns the frontier spend.',
    ]],
    ['bullets', 'What ThumbGate adds', [
      'A GPT-5.5 model candidate in config/model-candidates.json with long-context, data-analysis, dashboard-creation, charting, tool-use, and reliability strengths.',
      'A dashboard-analysis workload with metrics for insight accuracy, chart-spec validity, dashboard completeness, long-context reliability, latency, and cost per analysis.',
      'A CLI path: npx thumbgate model-candidates --workload=dashboard-analysis --provider=openai --json.',
      'A tier-router config that pins the frontier tier to gpt-5.5 while keeping explicit cheaper tiers for fast, low-cost work.',
    ]],
    ['paragraphs', 'Where this creates ROI', [
      'This gives platform teams a defensible answer to "should we move to GPT-5.5?" Run the candidate report, attach gate and benchmark evidence, and only then route high-value analytical or long-context agent tasks to the frontier tier.',
      'The commercial wedge is a Workflow Hardening Sprint focused on model routing: define which workflows deserve frontier spend, which stay on cheap tiers, and which require pre-action checks before a model can touch live systems.',
    ]],
  ],
  faq: [
    [
      'Should every ThumbGate task use GPT-5.5?',
      'No. Cheap gates, classification, extraction, and simple triage should stay on lower-cost tiers when they pass evals. GPT-5.5 is best evaluated for complex reasoning, long-context, coding, dataset, and dashboard work.',
    ],
    [
      'How do I benchmark GPT-5.5 in ThumbGate?',
      'Run npx thumbgate model-candidates --workload=dashboard-analysis --provider=openai --json, then use the emitted benchmark commands and metrics to compare insight quality, chart validity, latency, and cost before changing routing defaults.',
    ],
    [
      'Does this automatically call the OpenAI API?',
      'No. The catalog is an evaluation and routing surface. It records candidate models and benchmark plans without assuming provider credentials or silently changing runtime behavior.',
    ],
  ],
  relatedPaths: ['/guides/agent-harness-optimization', '/guides/background-agent-governance', '/guides/pre-action-checks'],
});

function buildModelUpgradeEvaluationGuide() {
  return preActionGuide(MODEL_UPGRADE_EVALUATION_GUIDE_SPEC.slug, {
    ...MODEL_UPGRADE_EVALUATION_GUIDE_SPEC.meta,
    takeaways: MODEL_UPGRADE_EVALUATION_GUIDE_SPEC.takeaways,
    sections: MODEL_UPGRADE_EVALUATION_GUIDE_SPEC.sections.map(([kind, heading, entries]) => buildSectionFromSpec(kind, heading, entries)),
    faq: MODEL_UPGRADE_EVALUATION_GUIDE_SPEC.faq.map(([question, text]) => answer(question, text)),
    relatedPaths: MODEL_UPGRADE_EVALUATION_GUIDE_SPEC.relatedPaths,
  });
}

const BROWSER_BRIDGE_GUIDE_SPECS = Object.freeze([
  {
    slug: 'browser-automation-safety',
    meta: {
      query: 'browser automation safety',
      title: 'Browser Automation Safety | Prompt Injection, Permissions, and Pre-Action Checks',
      heroTitle: 'Browser automation safety needs explicit approval boundaries',
      heroSummary: 'Browser agents can click, type, and navigate for you, but they also widen prompt-injection and cross-app integration risk. ThumbGate adds approval boundaries, auditability, and a native messaging audit before those bridges turn into silent blast-radius expansion.',
    },
    takeaways: [
      'Browser automation is useful because it has real permissions, which is exactly why it needs governance.',
      'Prompt injection becomes more dangerous when an extension can reach a local executable through a browser bridge.',
      'ThumbGate gives teams a first action now: audit native messaging hosts, then require explicit approval before browser-use connectors expand.',
    ],
    sections: [
      ['paragraphs', 'Why browser-use changes the threat model', [
        'Browser agents do not just read text. They can click buttons, fill forms, switch tabs, and sometimes bridge into local binaries. That means the blast radius is no longer only "bad output" but "real actions on live websites and local systems."',
        'Once browser automation enters the stack, prompt injection stops being an abstract model weakness and becomes a workflow-governance problem. The right control is not more prompt advice. It is a hard boundary around what the agent is allowed to connect, install, and execute.',
      ]],
      ['bullets', 'What to audit first', [
        'Which browser extensions hold automation permissions such as debugger, tabs, downloads, and nativeMessaging.',
        'Whether the desktop app or CLI has registered native messaging hosts for browsers you did not explicitly connect.',
        'Whether host manifests point to live local binaries and whether those binaries sit outside the browser sandbox.',
        'Whether browser-use runs default to ask-before-acting or silently expand capability before a human approves them.',
      ]],
      ['paragraphs', 'How ThumbGate fits', [
        'ThumbGate is the approval and enforcement layer around browser-use. Start by running npx thumbgate native-messaging-audit. Then gate future connector installs, record who approved them, and turn browser-bridge mistakes into Pre-Action Checks before the same pattern repeats.',
      ]],
    ],
    faq: [
      [
        'Why is browser automation riskier than ordinary chat?',
        'Because the agent can take real actions in a browser and may also reach local executables through native messaging bridges. That turns prompt injection and permission drift into operational risk, not just output-quality risk.',
      ],
      [
        'What should a team do before enabling browser-use broadly?',
        'Audit native messaging hosts, review extension permissions, keep ask-before-acting enabled by default, and require explicit approval for any cross-app connector that expands the agent runtime beyond the browser sandbox.',
      ],
    ],
    relatedPaths: ['/guides/native-messaging-host-security', '/guides/pre-action-checks'],
  },
  {
    slug: 'native-messaging-host-security',
    meta: {
      query: 'native messaging host security',
      title: 'Native Messaging Host Security | Audit Browser Bridges Before They Expand',
      heroTitle: 'Native messaging host security for AI browser bridges',
      heroSummary: 'Native messaging hosts let browser extensions talk to local executables. That can be useful, but it also creates a persistent bridge outside the browser sandbox. ThumbGate audits those registrations and helps teams require explicit approval before they become part of the workflow.',
    },
    takeaways: [
      'Native messaging is a real local capability boundary, not a harmless implementation detail.',
      'A manifest can pre-authorize extension origins long before a human operator understands the blast radius.',
      'ThumbGate turns native messaging review into an auditable operator workflow instead of an invisible local side effect.',
    ],
    sections: [
      ['paragraphs', 'What native messaging hosts actually do', [
        'A native messaging host is a local manifest that tells a browser extension which executable it may launch on the operator machine. That bridge sits outside the browser sandbox, so it deserves the same review discipline teams use for deploy credentials or production write access.',
        'The risk is not only the host binary itself. It is the combination of extension permissions, allowed origins, and whether the host remains registered for browsers the operator did not intentionally connect.',
      ]],
      ['bullets', 'Signals ThumbGate audits', [
        'Manifest files under browser-specific NativeMessagingHosts directories on macOS and Linux.',
        'Allowed extension origins and extension-id fan-out per host registration.',
        'Host binaries that are missing on disk, which leaves stale or broken registrations behind.',
        'AI/browser bridge manifests registered for browsers not detected in the usual local install paths.',
      ]],
      ['paragraphs', 'The fastest operator action', [
        'Run npx thumbgate native-messaging-audit --json in the repo or workstation you govern. Review every AI browser bridge, remove anything you did not intentionally integrate, and keep browser-use in ask-before-acting mode until connector scope is explicit and revocable.',
      ]],
    ],
    faq: [
      [
        'Why does native messaging deserve a separate security review?',
        'Because it lets a browser extension hand work to a local executable outside the browser sandbox. That is a different trust boundary than ordinary page automation or side-panel UI access.',
      ],
      [
        'How does ThumbGate help with native messaging host security?',
        'ThumbGate audits known host locations, highlights AI/browser bridges, flags stale or missing host binaries, and gives teams an enforcement layer so future connector expansion requires explicit approval.',
      ],
    ],
    relatedPaths: ['/guides/browser-automation-safety', '/guides/pre-action-checks'],
  },
]);

function buildBrowserBridgeGuide(spec) {
  return preActionGuide(spec.slug, {
    ...spec.meta,
    takeaways: spec.takeaways,
    sections: spec.sections.map(([kind, heading, entries]) => buildSectionFromSpec(kind, heading, entries)),
    faq: spec.faq.map(([question, text]) => answer(question, text)),
    relatedPaths: spec.relatedPaths,
  });
}

const AI_RECOMMENDATION_VISIBILITY_GUIDE_SPECS = Object.freeze([
  {
    slug: 'ai-search-topical-presence',
    meta: {
      query: 'ai search topical presence',
      title: 'AI Search Topical Presence | Become the Obvious Recommendation',
      heroTitle: 'AI search topical presence decides who gets recommended',
      heroSummary: 'AI assistants recommend the tools they repeatedly see tied to a problem in credible contexts. ThumbGate wins when the web consistently connects it to pre-action checks, AI coding agent safety, and stopping repeated mistakes before execution.',
    },
    takeaways: [
      'Topical presence is about repeated, credible association with the problems buyers actually ask AI systems to solve.',
      'ThumbGate should own a narrow association first: pre-action checks for AI coding agents.',
      'Proof assets, comparisons, integration pages, and category guides build the depth and breadth that make recommendations stick.',
    ],
    sections: [
      ['paragraphs', 'What topical presence really measures', [
        'AI search visibility is not just page count or classic keyword volume. It is the strength of the association between your brand, the buyer problem, and the category language the model has already absorbed.',
        'For ThumbGate, that means showing up around pre-action checks, stopping repeated AI agent mistakes, AI coding agent guardrails, workflow hardening, and runtime enforcement. When those associations repeat across guides, product copy, proof artifacts, and third-party mentions, the model gains confidence retrieving ThumbGate for the right prompt.',
      ]],
      ['bullets', 'How ThumbGate improves topical presence', [
        'Lead with one crisp category association: ThumbGate is the pre-action checks layer for AI coding agents.',
        'Publish proof-backed pages that connect the product to repeated-mistake blocking, workflow hardening, and team enforcement.',
        'Cover adjacent commercial prompts such as Codex guardrails, Cursor repeat-failure prevention, browser automation safety, and Autoresearch safety.',
        'Keep pricing, verification evidence, and supported-agent compatibility easy for humans and LLMs to quote.',
      ]],
      ['paragraphs', 'What to publish next', [
        'The fastest way to improve topical presence is not random content fan-out. It is a small set of specific, high-intent pages that reinforce the same recommendation pattern from different angles. ThumbGate should keep tightening the loop between buyer questions, proof links, integration pages, and machine-readable evidence.',
      ]],
    ],
    faq: [
      [
        'Is topical presence the same thing as AI share of voice?',
        'No. Share of voice tells you how often you appear. Topical presence tells you which problems and concepts the model actually associates with your brand, which is much more useful when you want to become the default recommendation.',
      ],
      [
        'What should a developer tool do first to improve topical presence?',
        'Pick one narrow, commercially relevant association and reinforce it everywhere. For ThumbGate, that association is pre-action checks for AI coding agents backed by verification evidence and workflow hardening outcomes.',
      ],
    ],
    relatedPaths: ['/guides/relational-knowledge-ai-recommendations', '/guides/pre-action-checks'],
  },
  {
    slug: 'relational-knowledge-ai-recommendations',
    meta: {
      query: 'relational knowledge ai recommendations',
      title: 'Relational Knowledge in AI Recommendations | Why Brands Get Picked',
      heroTitle: 'Relational knowledge explains why AI systems recommend some tools and ignore others',
      heroSummary: 'LLMs do not recommend brands from keywords alone. They retrieve stored associations between a problem, a category, and the brand they have repeatedly seen in that context. ThumbGate benefits when those associations stay crisp and evidence-backed.',
    },
    takeaways: [
      'AI recommendations come from learned associations, not from whichever brand publishes the most pages.',
      'Crowded many-to-many categories make generic positioning disappear into the noise.',
      'ThumbGate should reinforce a tight relationship: repeated AI coding mistakes -> pre-action checks -> ThumbGate.',
    ],
    sections: [
      ['paragraphs', 'Relational knowledge in plain English', [
        'A language model stores facts and associations about the world. When a buyer asks for a recommendation, the model tries to retrieve the brand most strongly associated with that problem and category. If the associations are weak or generic, the model falls back to louder or simpler competitors.',
        'That is why vague positioning like "AI memory for agents" is a weaker long-term recommendation strategy for ThumbGate than a sharper relationship such as "pre-action checks that stop repeated AI coding mistakes before execution."',
      ]],
      ['bullets', 'How ThumbGate becomes the obvious recommendation', [
        'Repeat the same category language across landing copy, guides, README links, and structured data.',
        'Pair the association with proof: verification evidence, automation proof, supported agents, and pricing.',
        'Publish comparisons that explain why memory-only or spec-only alternatives do not solve repeated tool-call failures.',
        'Expand outward from the core association into adjacent prompts only after the primary link is strong.',
      ]],
      ['paragraphs', 'Where teams usually get lost', [
        'Brands become invisible when they try to cover too many adjacent categories without owning one association deeply. ThumbGate should keep using specific buyer-language such as workflow hardening, pre-action checks, repeat-failure blocking, browser bridge safety, and AI coding agent guardrails so the recommendation path stays crisp.',
      ]],
    ],
    faq: [
      [
        'Why does content volume alone fail to earn AI recommendations?',
        'Because models care about the consistency and credibility of the association, not just the amount of text. Fifty vague pages rarely beat a smaller set of pages, proofs, and third-party mentions that all reinforce the same relationship.',
      ],
      [
        'What signals help ThumbGate most?',
        'Pages that tie ThumbGate to pre-action checks, AI coding agent safety, stopping repeated mistakes, supported-agent compatibility, and proof-backed outcomes help the model retrieve it with more confidence.',
      ],
    ],
    relatedPaths: ['/guides/ai-search-topical-presence', '/compare/mem0'],
  },
]);

function buildAiRecommendationVisibilityGuide(spec) {
  return preActionGuide(spec.slug, {
    ...spec.meta,
    takeaways: spec.takeaways,
    sections: spec.sections.map(([kind, heading, entries]) => buildSectionFromSpec(kind, heading, entries)),
    faq: spec.faq.map(([question, text]) => answer(question, text)),
    relatedPaths: spec.relatedPaths,
  });
}

const PAGE_BLUEPRINTS = [
  {
    query: 'thumbgate vs speclock',
    path: '/compare/speclock',
    pageType: 'comparison',
    pillar: 'comparison',
    title: 'ThumbGate vs SpecLock | Thumbs Feedback vs Manual Specs',
    heroTitle: 'ThumbGate vs SpecLock',
    heroSummary: 'SpecLock starts from manually written constraints. ThumbGate starts from thumbs-up/down feedback and turns it into pre-action checks that block repeated mistakes.',
    takeaways: [
      'ThumbGate learns from thumbs-up and thumbs-down feedback without requiring a separate spec-writing workflow.',
      'SpecLock is strongest when a team already has strong specifications and wants enforcement tied to those documents.',
      'ThumbGate is strongest when the pain is repeated agent mistakes across Claude Code, Cursor, Codex, Gemini, Amp, and OpenCode.',
    ],
    sections: [
      {
        heading: 'The product difference in one sentence',
        paragraphs: [
          'SpecLock helps a team codify rules before the work begins. ThumbGate helps a team convert real thumbs-up/down feedback into live pre-action checks after the work reveals what actually breaks.',
          'That means ThumbGate is better for fast-moving agent workflows where the problem is not writing more specs, but preventing the same mistake from happening again tomorrow.',
        ],
      },
      {
        heading: 'Choose ThumbGate when',
        bullets: [
          'Your agent already repeats known mistakes and you need the block to happen before tool execution.',
          'You want one feedback loop that supports both reinforcement from thumbs up and prevention from thumbs down.',
          'You need proof assets, automation reports, and compatibility across multiple coding agents.',
        ],
      },
      {
        heading: 'Choose SpecLock when',
        bullets: [
          'Your team already maintains strong PRDs or system specs and wants the model constrained against those artifacts.',
          'Your primary problem is uncontrolled file edits, not a missing feedback-to-enforcement loop.',
          'You are willing to invest in manual constraint authoring as part of the workflow.',
        ],
      },
    ],
    faq: [
      {
        question: 'Is ThumbGate trying to replace specs?',
        answer: 'No. ThumbGate complements specs by capturing thumbs-up/down feedback from live agent behavior and enforcing the learned rules as pre-action checks.',
      },
      {
        question: 'What does ThumbGate do that SpecLock does not?',
        answer: 'ThumbGate turns explicit feedback into searchable memory, auto-generated prevention rules, and runtime checks that block repeated mistakes before the next tool call executes.',
      },
    ],
    relatedPaths: ['/compare/mem0', '/guides/pre-action-checks'],
  },
  {
    query: 'thumbgate vs mem0',
    path: '/compare/mem0',
    pageType: 'comparison',
    pillar: 'comparison',
    title: 'ThumbGate vs Mem0 | Enforcement vs Memory for AI Agents',
    heroTitle: 'ThumbGate vs Mem0',
    heroSummary: 'Mem0 is memory. ThumbGate is memory plus enforcement. It captures thumbs-up/down feedback, promotes the signal into rules, and blocks repeat failures with pre-action checks.',
    takeaways: [
      'Mem0 is useful when you mainly need retrieval and cross-session context.',
      'ThumbGate is useful when retrieval alone is not enough and the system has to stop the same mistake before execution.',
      'ThumbGate adds proof assets and automation reports so the buying story is stronger for engineering teams.',
    ],
    sections: [
      {
        heading: 'Where Mem0 fits',
        paragraphs: [
          'Mem0 is designed as a cloud memory layer. It helps the model remember context and past interactions, but memory alone does not guarantee that the next action is safe.',
        ],
      },
      {
        heading: 'Where ThumbGate fits',
        paragraphs: [
          'ThumbGate begins with the same need to remember, but it goes further. A thumbs down can become a prevention rule, and that rule can become a pre-action check that blocks a repeated tool call.',
        ],
        bullets: [
          'Thumbs up reinforces good behavior.',
          'Thumbs down blocks repeated mistakes.',
          'Verification evidence and automation reports back up the reliability claim.',
        ],
      },
      {
        heading: 'Which page should rank',
        paragraphs: [
          'This comparison page should win when the searcher is already deciding between a memory system and an enforcement system. The goal is to make the distinction obvious in under 30 seconds.',
        ],
      },
    ],
    faq: [
      {
        question: 'Does ThumbGate still include memory?',
        answer: 'Yes. ThumbGate keeps local-first memory, ContextFS packs, lesson search, and recall, but adds pre-action enforcement when memory alone is insufficient.',
      },
      {
        question: 'Why compare Mem0 at all?',
        answer: 'Because buyers often start with memory tooling and only later realize they also need enforcement. This page makes that upgrade path explicit.',
      },
    ],
    relatedPaths: ['/compare/speclock', '/guides/claude-code-feedback'],
  },
  {
    query: 'pre-action checks for ai coding agents',
    path: '/guides/pre-action-checks',
    pageType: 'guide',
    pillar: 'pre-action-checks',
    title: 'Pre-Action Checks for AI Coding Agents | ThumbGate Guide',
    heroTitle: 'What Are Pre-Action Checks?',
    heroSummary: 'Pre-action gates stop the risky move before the agent executes it. ThumbGate uses thumbs-up/down feedback to decide what should be reinforced, warned, or blocked.',
    takeaways: [
      'Prompt rules are advisory. Pre-action gates are enforcement.',
      'A repeated thumbs down can become a warning gate or a hard block.',
      'The right proof asset is not the rule text alone but the evidence that the gate fired before damage.',
    ],
    sections: [
      {
        heading: 'Why this matters',
        paragraphs: [
          'Most AI coding failures are not mysterious. They are repeated mistakes: force-pushes, destructive scripts, missed verification steps, or breaking architectural constraints.',
          'A pre-action check turns that failure pattern into a runtime checkpoint. The agent sees the stop before the bad action lands.',
        ],
      },
      {
        heading: 'How ThumbGate makes the loop useful',
        bullets: [
          'Capture structured thumbs-up/down feedback.',
          'Promote repeated failures into prevention rules.',
          'Score and enforce the rules with Thompson Sampling and pre-action hooks.',
          'Publish verification evidence so the system is auditable.',
        ],
      },
      {
        heading: 'Best next step',
        paragraphs: [
          'If a buyer is exploring the category, this page should move them to either a comparison page or the main product proof pack.',
        ],
      },
    ],
    faq: [
      {
        question: 'How are pre-action checks different from prompt rules?',
        answer: 'Prompt rules ask the model nicely. Pre-action gates intercept the tool call and block it before execution when the known-bad pattern matches.',
      },
      {
        question: 'Can a thumbs up matter too?',
        answer: 'Yes. ThumbGate explicitly uses thumbs up to reinforce successful behavior so the system is not only punitive.',
      },
    ],
    relatedPaths: ['/compare/speclock', '/guides/claude-code-feedback'],
  },
  {
    query: 'best tools to stop ai agents from breaking production',
    path: '/guides/best-tools-stop-ai-agents-breaking-production',
    pageType: 'guide',
    pillar: 'pre-action-checks',
    title: 'Best Tools to Stop AI Agents From Breaking Production | ThumbGate Listicle',
    heroTitle: 'Best Tools to Stop AI Agents From Breaking Production',
    heroSummary: 'A practical listicle for teams adopting Claude Code, Cursor, Codex, Gemini, and other coding agents: the winning reliability stack is workflow-first, inspection-driven, and enforced before tool execution.',
    takeaways: [
      'Answer engines cite specific blog posts and listicles more readily than generic product pages, so this guide names the buyer prompt directly.',
      'Production agent safety starts with predefined workflows when possible, then gates open-ended agents when autonomy is actually needed.',
      'ThumbGate is the pre-action enforcement layer that checks workflow shape, environment inspection evidence, and parallel branch budgets before risky execution.',
    ],
    sections: [
      {
        heading: 'The short list',
        bullets: [
          'Workflow templates for known paths: use repeatable plans for deploys, migrations, release checks, and PR cleanup instead of asking an agent to improvise every time.',
          'Environment inspection requirements: require file reads, screenshots, API responses, or command output before the agent claims the state of the world.',
          'Pre-action enforcement: block risky tool calls before execution when the action violates a learned rule, budget, or inspection requirement.',
          'Parallel branch budgets: cap fan-out so multi-agent desktop sessions do not burn tokens, duplicate work, or merge conflicting changes blindly.',
          'Repeated-failure memory: turn thumbs-down reviews into prevention rules and thumbs-up reviews into reinforced safe patterns.',
        ],
      },
      {
        heading: 'Where ThumbGate fits',
        paragraphs: [
          'ThumbGate is not another prompt reminder. It sits at the action boundary, where a coding agent is about to edit files, run commands, call tools, or promote a result.',
          'That makes it a strong answer to long-tail buyer prompts like "how do I stop Claude Code from repeating a production mistake" or "what guardrails should I add before running parallel AI coding agents."',
        ],
      },
      {
        heading: 'What to look for in any tool',
        bullets: [
          'Can it tell whether the work should be a workflow or an open-ended agent?',
          'Can it prove the agent inspected the environment before acting?',
          'Can it block the next bad action, not just remember that the last one was bad?',
          'Can it expose evidence that auditors, teammates, and future agents can read?',
        ],
      },
      {
        heading: 'Promotion angle',
        paragraphs: [
          'This page is designed as AEO fuel: it gives AI answer engines a quotable, specific, buyer-intent explanation of why production AI agents need pre-action checks, inspection evidence, and workflow budgets.',
        ],
      },
    ],
    faq: [
      {
        question: 'What is the best tool to stop AI coding agents from breaking production?',
        answer: 'Use workflow templates for predictable tasks, then add ThumbGate as the pre-action enforcement layer so repeated mistakes, missing inspection evidence, and unsafe parallel fan-out can be blocked before execution.',
      },
      {
        question: 'Why are listicles useful for AI search visibility?',
        answer: 'AI answer engines often cite specific educational pages that match the buyer prompt. A focused listicle gives the model a clear source for production-agent guardrails instead of forcing it to infer the category from generic landing-page copy.',
      },
      {
        question: 'Do I need an agent or a workflow?',
        answer: 'Use a workflow when the path is known and testable. Use an agent when the path is genuinely uncertain, but require environment inspection and pre-action gates before risky tool use.',
      },
    ],
    relatedPaths: ['/guides/pre-action-checks', '/guides/agent-harness-optimization', '/guides/ai-search-topical-presence'],
  },
  buildHarnessOptimizationGuide(),
  buildBackgroundAgentGovernanceGuide(),
  buildModelUpgradeEvaluationGuide(),
  {
    query: 'stop ai coding agents from repeating mistakes',
    path: '/guides/stop-repeated-ai-agent-mistakes',
    pageType: 'guide',
    pillar: 'pre-action-checks',
    title: 'How to Stop AI Coding Agents From Repeating Mistakes | ThumbGate',
    heroTitle: 'How to Stop AI Coding Agents From Repeating Mistakes',
    heroSummary: 'If your agent keeps repeating the same bad move, the fix is not more memory alone. The fix is a feedback loop that turns repeated failures into pre-action checks before the next tool call executes.',
    takeaways: [
      'Repeated mistakes are a workflow problem, not just a context-window problem.',
      'ThumbGate turns thumbs-down feedback into prevention rules and runtime gates.',
      'This page is meant to move problem-aware buyers into the Pro path or a concrete install.',
    ],
    sections: [
      {
        heading: 'Why repeated mistakes keep happening',
        paragraphs: [
          'AI coding agents are fast, but they forget operational pain surprisingly easily. One bad deployment, force-push, or skipped verification step often turns into another because the system remembered the transcript but never enforced the lesson.',
          'That is why teams feel stuck in a correction loop. They keep teaching the same rule, but the next session still allows the same risky action.',
        ],
      },
      {
        heading: 'What changes when feedback becomes enforcement',
        bullets: [
          'Thumbs down captures the exact failure you do not want repeated.',
          'Repeated failures promote into linked prevention rules.',
          'Pre-action gates intercept the risky tool call before execution.',
          'Thumbs up reinforces the safe path so the agent learns what good looks like too.',
        ],
      },
      {
        heading: 'What a buyer should do next',
        paragraphs: [
          'If the pain is already real, do not start with a long architecture project. Start by wiring ThumbGate into the workflow where the agent has already burned time or trust, then watch the next repeat attempt get blocked before damage lands.',
        ],
      },
    ],
    faq: [
      {
        question: 'Is memory alone enough to stop repeated mistakes?',
        answer: 'Usually no. Memory helps retrieval, but ThumbGate adds pre-action checks so the same risky move can be blocked before the next command executes.',
      },
      {
        question: 'Does ThumbGate only punish bad behavior?',
        answer: 'No. Thumbs up reinforces good behavior, so the loop captures safe patterns as well as failures.',
      },
    ],
    relatedPaths: ['/guides/pre-action-checks', '/guides/claude-code-feedback'],
  },
  {
    query: 'claude code feedback memory',
    path: '/guides/claude-code-feedback',
    pageType: 'integration',
    pillar: 'agent-workflows',
    title: 'Claude Code Feedback Memory with Thumbs Up and Thumbs Down',
    heroTitle: 'Claude Code Feedback Memory That Actually Enforces',
    heroSummary: 'Claude Code can remember more when the memory is structured, but reliability improves when thumbs-up/down feedback also becomes enforceable behavior. That is ThumbGate\'s angle.',
    takeaways: [
      'Claude Code users usually feel the pain as repeated mistakes across sessions.',
      'ThumbGate captures the thumbs-up/down signal and turns it into memory, rules, and gates.',
      'The page should convert Claude Code searchers into a product trial or a comparison-page reader.',
    ],
    sections: [
      {
        heading: 'The Claude Code problem',
        paragraphs: [
          'Claude Code is strongest when the context is fresh, but teams still hit repeated mistakes, compaction drift, and re-explaining constraints. A memory file alone helps, but it does not physically stop the next bad move.',
        ],
      },
      {
        heading: 'The ThumbGate angle',
        bullets: [
          'Thumbs up reinforces good behavior.',
          'Thumbs down becomes a prevention rule.',
          'Pre-action gates stop the repeated mistake before the next command executes.',
          'The same flow works across Cursor, Codex, Gemini, Amp, and OpenCode.',
        ],
      },
      {
        heading: 'What to show on this page',
        paragraphs: [
          'Compatibility proof, install speed, and verification evidence matter more than generic "memory" copy. The buyer should leave knowing that ThumbGate is the enforcement layer for Claude Code, not just another notebook of past context.',
        ],
      },
    ],
    faq: [
      {
        question: 'Does this only work with Claude Code?',
        answer: 'No. Claude Code is a strong entry point, but the same thumbs-up/down feedback loop and pre-action checks work across other MCP-compatible coding agents too.',
      },
      {
        question: 'Why mention thumbs up as well as thumbs down?',
        answer: 'Because reinforcement matters. Good behavior should become easier to repeat, not only bad behavior harder to repeat.',
      },
    ],
    relatedPaths: ['/guides/pre-action-checks', '/compare/mem0'],
  },
  {
    query: 'cursor prevent repeated mistakes',
    path: '/guides/cursor-agent-guardrails',
    pageType: 'integration',
    pillar: 'agent-workflows',
    title: 'Cursor Agent Guardrails | Stop Repeated Mistakes with ThumbGate',
    heroTitle: 'Cursor Guardrails That Block Repeated Mistakes',
    heroSummary: 'Cursor moves fast, which makes repeated mistakes expensive. ThumbGate gives Cursor users a feedback loop that turns thumbs-down corrections into pre-action checks before the next risky step fires.',
    takeaways: [
      'Cursor users want speed without trusting the agent blindly.',
      'ThumbGate adds enforcement without forcing a platform switch.',
      'The page should answer the buyer question in one line: how do I stop Cursor from doing the same bad thing again?',
    ],
    sections: [
      {
        heading: 'The Cursor workflow problem',
        paragraphs: [
          'Cursor can move from idea to edits quickly, but the failure mode is familiar: the same wrong refactor, risky shell command, or skipped check comes back in the next session because nothing hardened the workflow.',
        ],
      },
      {
        heading: 'How ThumbGate fits into Cursor',
        bullets: [
          'Capture thumbs-up/down feedback on agent behavior.',
          'Promote repeated failures into prevention rules.',
          'Block known-bad commands with pre-action checks before execution.',
          'Keep the memory and gates local-first so the operator retains control.',
        ],
      },
      {
        heading: 'What makes this different from a rule file',
        paragraphs: [
          'Static rules help on day one. ThumbGate helps on day two and day twenty because it keeps learning from live corrections instead of relying on a fixed checklist that drifts out of date.',
        ],
      },
    ],
    faq: [
      {
        question: 'Do I need to leave Cursor to use ThumbGate?',
        answer: 'No. ThumbGate is designed to sit alongside existing coding-agent workflows so you can add enforcement without switching tools.',
      },
      {
        question: 'What kind of mistakes can Cursor guardrails stop?',
        answer: 'Repeated failures like risky git actions, destructive scripts, skipped verification, or any other known-bad pattern you have already corrected once.',
      },
    ],
    relatedPaths: ['/guides/stop-repeated-ai-agent-mistakes', '/guides/pre-action-checks'],
  },
  {
    query: 'codex cli guardrails',
    path: '/guides/codex-cli-guardrails',
    pageType: 'integration',
    pillar: 'agent-workflows',
    title: 'Codex CLI Guardrails | Prevent Repeated Mistakes with ThumbGate',
    heroTitle: 'Codex CLI Guardrails That Actually Enforce',
    heroSummary: 'Codex CLI can move quickly through repo tasks, but buyers need more than good intentions. ThumbGate adds a reliability gateway so repeated mistakes become searchable lessons, linked rules, and pre-action enforcement.',
    takeaways: [
      'Codex CLI buyers are usually looking for safe autonomy, not just more prompts.',
      'ThumbGate sits in the critical gap between feedback and execution.',
      'This page should rank for people who want guardrails without giving up CLI speed.',
    ],
    sections: [
      {
        heading: 'What Codex CLI users usually need',
        paragraphs: [
          'The problem is rarely a single bad command. It is the cost of the same failure pattern showing up across branches, sessions, or rushed workflows. Once that pattern is obvious, the buyer wants a durable control point.',
        ],
      },
      {
        heading: 'What ThumbGate adds',
        bullets: [
          'Feedback capture with explicit thumbs-up/down signals.',
          'Searchable lessons and linked prevention rules.',
          'Pre-action checks that block repeated bad commands before they run.',
          'Verification evidence that gives teams something concrete to audit.',
        ],
      },
      {
        heading: 'Why this matters for revenue',
        paragraphs: [
          'Guardrails are easier to buy when the outcome is obvious: less rework, fewer repeated failures, and a visible chain from operator feedback to enforced behavior.',
        ],
      },
    ],
    faq: [
      {
        question: 'Is ThumbGate only for Codex CLI?',
        answer: 'No. Codex CLI is one supported workflow, but the same feedback and enforcement loop also works across Claude Code, Cursor, Gemini, Amp, and OpenCode.',
      },
      {
        question: 'How are Codex CLI guardrails different from prompt instructions?',
        answer: 'Prompt instructions are advisory. ThumbGate pre-action checks intercept the tool call itself and block the known-bad pattern before execution.',
      },
    ],
    relatedPaths: ['/guides/pre-action-checks', '/compare/mem0'],
  },
  {
    query: 'gemini cli feedback memory',
    path: '/guides/gemini-cli-feedback-memory',
    pageType: 'integration',
    pillar: 'agent-workflows',
    title: 'Gemini CLI Feedback Memory | Memory Plus Enforcement with ThumbGate',
    heroTitle: 'Gemini CLI Feedback Memory That Leads to Enforcement',
    heroSummary: 'Gemini CLI users often start by asking for better memory. ThumbGate answers the bigger need: memory that can become prevention rules and pre-action checks when the same mistake shows up twice.',
    takeaways: [
      'Gemini CLI searchers often begin with memory but buy because of enforcement.',
      'ThumbGate keeps the local-first memory story while adding runtime blocking.',
      'The ideal conversion path here is memory query to product proof to Pro page.',
    ],
    sections: [
      {
        heading: 'Why memory is only step one',
        paragraphs: [
          'Persistent memory helps Gemini CLI recall past context, but it still leaves a blind spot. Remembering that a workflow went badly is different from preventing the next risky action when the same pattern appears again.',
        ],
      },
      {
        heading: 'What ThumbGate adds on top',
        bullets: [
          'Local-first lessons you can search across sessions.',
          'Structured thumbs-up/down feedback for reinforcement and correction.',
          'Prevention rules linked to past failures.',
          'Pre-action gates that stop repeated mistakes before execution.',
        ],
      },
      {
        heading: 'Who this is really for',
        paragraphs: [
          'This page is for operators who already know memory matters, but now need a reliability layer that protects live workflows instead of just preserving notes about them.',
        ],
      },
    ],
    faq: [
      {
        question: 'Does ThumbGate replace Gemini CLI memory?',
        answer: 'No. ThumbGate extends the memory story with searchable lessons, rules, and gates so memory becomes operationally useful instead of purely historical.',
      },
      {
        question: 'Can this stay local-first?',
        answer: 'Yes. ThumbGate is built for local-first workflows, which lowers risk for developers who do not want sensitive history pushed into a hosted memory layer.',
      },
    ],
    relatedPaths: ['/compare/mem0', '/guides/stop-repeated-ai-agent-mistakes'],
  },
  {
    query: 'roo code alternative cline',
    path: '/guides/roo-code-alternative-cline',
    pageType: 'integration',
    pillar: 'agent-workflows',
    title: 'Roo Code Alternative: Migrating to Cline with Portable Lesson Memory',
    heroTitle: 'Roo Code Alternative: Migrate to Cline Without Losing Agent Memory',
    heroSummary: 'Roo Code is shutting down on May 15, 2026, and its own docs point users to Cline. ThumbGate keeps the migration from resetting every hard-won thumbs-down and workflow correction back to zero.',
    takeaways: [
      'Roo users have a time-bound migration problem with clear buyer urgency.',
      'The real wedge is portable lesson memory, not just swapping one VS Code extension for another.',
      'The page should answer the migration question and route serious operators into a local-first enforcement path.',
    ],
    sections: [
      {
        heading: 'Why the migration risk is bigger than the extension swap',
        paragraphs: [
          'Roo users can usually move to Cline without much trouble at the MCP layer. The hidden risk is losing every correction that only lived in the old agent context.',
          'If the same git, deploy, or migration mistake has to be re-taught from scratch after the swap, the migration cost is higher than it looks.',
        ],
      },
      {
        heading: 'What ThumbGate adds to the move',
        bullets: [
          'Keep lessons in a local SQLite plus FTS5 store instead of vendor-scoped memory.',
          'Turn repeated failures into prevention rules and pre-action checks before the next tool call runs.',
          'Reuse the same local memory across Cline, Claude Code, Cursor, Codex, Gemini CLI, Amp, and other MCP-compatible agents.',
          'Give migration buyers a proof-backed install path instead of another generic memory promise.',
        ],
      },
      {
        heading: 'Why this converts',
        paragraphs: [
          'A migration deadline creates urgency, but the stronger buying reason is avoiding repeated rework after the switch. Portable lesson memory plus enforced checks is the part buyers can immediately understand and verify.',
        ],
      },
    ],
    faq: [
      {
        question: 'Why not just switch from Roo to Cline and keep going?',
        answer: 'Because the workflow memory can still reset if past corrections only lived inside the old agent context. ThumbGate keeps those lessons in a local store that survives the vendor swap.',
      },
      {
        question: 'Does ThumbGate only help with Cline?',
        answer: 'No. Cline is the immediate migration path, but the same local lesson memory and pre-action checks work across other MCP-compatible coding agents too.',
      },
    ],
    relatedPaths: ['/guides/codex-cli-guardrails', '/guides/stop-repeated-ai-agent-mistakes'],
  },
  ...BROWSER_BRIDGE_GUIDE_SPECS.map(buildBrowserBridgeGuide),
  ...AI_RECOMMENDATION_VISIBILITY_GUIDE_SPECS.map(buildAiRecommendationVisibilityGuide),
  guideBlueprint({
    query: 'autoresearch agent safety',
    path: '/guides/autoresearch-agent-safety',
    pillar: 'pre-action-checks',
    title: 'Autoresearch Agent Safety | Gates for Self-Improving Coding Agents',
    heroTitle: 'Autoresearch Agent Safety for Self-Improving Coding Agents',
    heroSummary: 'Autoresearch-style loops can search for better code, but they need gates for holdout tests, proof trails, reward hacking, and unsafe self-improvement.',
    takeaways: [
      'Self-improving coding loops need a control plane before they promote their own wins.',
      'ThumbGate turns failed experiment reviews into prevention rules and pre-action checks.',
      'The sales wedge is concrete: let the agent search, but gate the evidence before it accepts a variant.',
    ],
    sections: [
      paragraphs(
        'Why Autoresearch creates a new buying moment',
        [
          'Autoresearch-style systems run experiments, inspect results, and keep the variants that look better. That makes them powerful, but it also creates a trust gap for engineering teams.',
          'If the loop can edit the benchmark, skip a holdout, hide a failed run, or promote without proof, the buyer needs enforcement before autonomy expands.',
        ],
      ),
      bullets(
        'Where ThumbGate fits',
        [
          'Block promotion when required primary and holdout checks are missing.',
          'Require commands, changed files, logs, and verification evidence before a claimed improvement lands.',
          'Capture thumbs-down reviews when an experiment cheats the metric, then promote the pattern into a prevention rule.',
          'Use ContextFS packs and Thompson Sampling so recurring research failures get stricter over time.',
        ],
      ),
      paragraphs(
        'Starter harnesses that make the value visible',
        [
          'The first pack should wrap checks buyers already understand: npm test, lint, Playwright duration, bundle size, and CI status. Each one becomes a gate the buyer can see firing.',
        ],
      ),
    ],
    faq: [
      answer(
        'Why do Autoresearch-style agents need gates?',
        'A self-improving loop can optimize the wrong signal, skip holdout tests, or promote a cherry-picked run. ThumbGate blocks known-bad promotion patterns before the agent accepts the variant.',
      ),
      answer(
        'What does ThumbGate add to an Autoresearch loop?',
        'ThumbGate adds structured thumbs-up/down feedback, prevention rules, Thompson Sampling, ContextFS proof packs, and pre-action checks for risky experiment and promotion steps.',
      ),
    ],
    relatedPaths: ['/guides/pre-action-checks', '/guides/codex-cli-guardrails'],
  }),
  {
    query: 'claude desktop extension plugin thumbgate',
    path: '/guides/claude-desktop',
    pageType: 'integration',
    pillar: 'agent-workflows',
    title: 'ThumbGate for Claude Desktop | Install the Plugin in 60 Seconds',
    heroTitle: 'ThumbGate for Claude Desktop',
    heroSummary: 'Install ThumbGate as a Claude Desktop plugin and get pre-action checks running in under a minute. No build step, no cloud account, no config files.',
    takeaways: [
      'One command installs ThumbGate into Claude Desktop with zero config.',
      'The packaged .mcpb bundle is available on GitHub Releases for drag-and-drop install.',
      'All feedback, rules, and gates stay local on your machine.',
    ],
    sections: [
      {
        heading: 'Install with one command',
        paragraphs: [
          'Run this in your terminal and Claude Desktop picks up ThumbGate automatically:',
          'npx thumbgate init --claude-desktop',
          'Or add the MCP server directly:',
          'claude mcp add thumbgate -- npx -y thumbgate serve',
        ],
      },
      {
        heading: 'Or download the packaged bundle',
        paragraphs: [
          'Grab the .mcpb bundle from GitHub Releases — no build step required. Drop it into Claude Desktop and you are running.',
        ],
        bullets: [
          'Download from: github.com/IgorGanapolsky/ThumbGate/releases',
          'Works with Claude Desktop on macOS, Windows, and Linux.',
          'All data stays local. No cloud account needed.',
        ],
      },
      {
        heading: 'What you get',
        bullets: [
          'Thumbs-up/down feedback capture inside Claude Desktop.',
          'Prevention rules auto-generated from repeated failures.',
          'Pre-action checks that block known-bad patterns before execution.',
          'Full-text search across your lesson history.',
          'Health checks and system diagnostics.',
        ],
      },
      {
        heading: 'Verify it works',
        paragraphs: [
          'After install, run npx thumbgate doctor to confirm all subsystems are healthy. You should see 4/4 HEALTHY.',
        ],
      },
    ],
    faq: [
      {
        question: 'Do I need a cloud account?',
        answer: 'No. ThumbGate runs entirely locally. Your feedback, rules, and gates never leave your machine.',
      },
      {
        question: 'What is the .mcpb bundle?',
        answer: 'It is a packaged Claude Desktop extension that includes the ThumbGate MCP server, tool definitions, and manifest — ready to install without building from source.',
      },
      {
        question: 'Does this work with Claude Code too?',
        answer: 'Yes. The same npx thumbgate init command works for both Claude Desktop and Claude Code. Use --claude-desktop for the Desktop-specific setup.',
      },
    ],
    relatedPaths: ['/guides/claude-code-feedback', '/guides/pre-action-checks'],
  },
];

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map((header) => slugify(header).replace(/-/g, '_'));
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

function loadKeywordRows(inputPath) {
  if (!inputPath) {
    return HIGH_ROI_QUERY_SEEDS.map((row) => ({ ...row }));
  }
  const resolved = path.resolve(inputPath);
  const raw = fs.readFileSync(resolved, 'utf8');
  if (resolved.endsWith('.json')) {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : data.rows || [];
  }
  if (resolved.endsWith('.jsonl')) {
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  if (resolved.endsWith('.csv')) {
    return parseCsv(raw);
  }
  throw new Error(`Unsupported keyword input format for ${resolved}`);
}

function classifyIntent(query) {
  const normalized = normalizeText(query).toLowerCase();
  if (!normalized) return 'informational';
  if (/\b(vs|versus|alternative|compare|comparison|better than)\b/.test(normalized)) return 'comparison';
  if (/\b(price|pricing|buy|checkout|purchase|cost)\b/.test(normalized)) return 'transactional';
  if (/\b(autoresearch|self-improving|benchmark|reward hacking|agent safety)\b/.test(normalized)) return 'commercial';
  if (/\b(claude code|cursor|codex|gemini|amp|opencode|integration|plugin|setup|install)\b/.test(normalized)) {
    return 'commercial';
  }
  if (/\b(what is|how to|guide|best practices|why)\b/.test(normalized)) return 'informational';
  if (/\b(guardrails|pre-action checks|feedback|prevent repeated mistakes|repeating mistakes|memory|harness optimization)\b/.test(normalized)) {
    return 'commercial';
  }
  return 'informational';
}

function inferPillar(query) {
  const normalized = normalizeText(query).toLowerCase();
  if (/\b(speclock|mem0|alternative|vs|compare|comparison)\b/.test(normalized)) return 'comparison';
  if (/\b(thumbs up|thumbs down|feedback|reinforce|mistake)\b/.test(normalized)) return 'feedback-loop';
  if (/\b(topical presence|relational knowledge|recommend(?:ation|ed)? brands?|ai search visibility)\b/.test(normalized)) return 'ai-agent-reliability';
  if (/\b(browser automation|native messaging|browser bridge|prompt injection)\b/.test(normalized)) return 'pre-action-checks';
  if (/\b(autoresearch|self-improving|benchmark|reward hacking|harness optimization)\b/.test(normalized)) return 'pre-action-checks';
  if (/\b(pre-action checks|guardrails|block|prevent repeated mistakes|repeating mistakes)\b/.test(normalized)) return 'pre-action-checks';
  if (/\b(claude code|cursor|codex|gemini|amp|opencode|integration|plugin)\b/.test(normalized)) return 'agent-workflows';
  return 'ai-agent-reliability';
}

function inferPersona(query) {
  const normalized = normalizeText(query).toLowerCase();
  if (normalized.includes('claude code')) return 'claude-code-builder';
  if (normalized.includes('cursor')) return 'cursor-builder';
  if (normalized.includes('codex')) return 'codex-builder';
  if (normalized.includes('gemini')) return 'gemini-builder';
  if (normalized.includes('autoresearch') || normalized.includes('self-improving')) return 'ai-research-engineer';
  if (/\b(vs|alternative|compare)\b/.test(normalized)) return 'tool-evaluator';
  if (/\b(guardrails|pre-action checks)\b/.test(normalized)) return 'engineering-lead';
  return 'ai-engineer';
}

function inferPageType(intent, query) {
  const normalized = normalizeText(query).toLowerCase();
  if (intent === 'comparison') return 'comparison';
  if (/\b(claude code|cursor|codex|gemini|amp|opencode|integration|plugin)\b/.test(normalized)) return 'integration';
  if (/\b(guide|how to|what is|best practices)\b/.test(normalized)) return 'guide';
  return intent === 'transactional' ? 'money-page' : 'guide';
}

function scoreOpportunity(row) {
  const query = normalizeText(row.query);
  const intent = row.intent || classifyIntent(query);
  const pillar = row.pillar || inferPillar(query);
  const pageType = row.pageType || inferPageType(intent, query);
  let score = 0;

  const intentWeight = {
    comparison: 40,
    transactional: 38,
    commercial: 32,
    informational: 24,
  };
  const pageTypeWeight = {
    comparison: 20,
    integration: 16,
    'money-page': 18,
    guide: 14,
  };
  const pillarWeight = {
    comparison: 14,
    'pre-action-checks': 12,
    'feedback-loop': 12,
    'agent-workflows': 11,
    'ai-agent-reliability': 9,
  };

  score += intentWeight[intent] || 20;
  score += pageTypeWeight[pageType] || 12;
  score += pillarWeight[pillar] || 8;
  score += clamp(toNumber(row.businessValue) || 0, 0, 25);

  const impressions = toNumber(row.impressions);
  const clicks = toNumber(row.clicks);
  const ctr = toNumber(row.ctr);
  const position = toNumber(row.position);

  if (impressions !== null) score += clamp(impressions / 20, 0, 10);
  if (clicks !== null) score += clamp(clicks, 0, 10);
  if (ctr !== null) score += clamp(ctr * 100, 0, 6);
  if (position !== null) {
    if (position >= 4 && position <= 25) score += 6;
    else if (position > 25) score += 3;
  }

  if (/\bthumbgate\b/.test(query.toLowerCase())) score += 4;
  if (/\b(claude code|cursor|codex|gemini|amp|opencode)\b/.test(query.toLowerCase())) score += 4;

  return clamp(Number(score.toFixed(2)), 0, 100);
}

function normalizeKeywordRow(row, index = 0) {
  const query = normalizeText(row.query || row.keyword || row.term || row.topic);
  if (!query) {
    throw new Error(`Keyword row ${index + 1} is missing query/keyword/term/topic`);
  }

  const normalized = {
    id: row.id || `kw_${index + 1}_${slugify(query)}`,
    query,
    source: normalizeText(row.source) || 'input',
    notes: normalizeText(row.notes) || null,
    impressions: toNumber(row.impressions),
    clicks: toNumber(row.clicks),
    ctr: toNumber(row.ctr),
    position: toNumber(row.position),
    businessValue: toNumber(row.businessValue) || 0,
  };

  normalized.intent = classifyIntent(normalized.query);
  normalized.pillar = inferPillar(normalized.query);
  normalized.persona = inferPersona(normalized.query);
  normalized.pageType = inferPageType(normalized.intent, normalized.query);
  normalized.opportunityScore = scoreOpportunity(normalized);
  return normalized;
}

function clusterKeywordRows(rows) {
  const clusters = new Map();

  for (const row of rows) {
    const key = row.pillar;
    if (!clusters.has(key)) {
      clusters.set(key, {
        pillar: key,
        pageType: row.pageType,
        queries: [],
        totalOpportunityScore: 0,
        primaryQuery: null,
        personas: new Set(),
        intents: new Set(),
      });
    }
    const cluster = clusters.get(key);
    cluster.queries.push(row);
    cluster.totalOpportunityScore += row.opportunityScore;
    cluster.personas.add(row.persona);
    cluster.intents.add(row.intent);
    if (!cluster.primaryQuery || row.opportunityScore > cluster.primaryQuery.opportunityScore) {
      cluster.primaryQuery = row;
      cluster.pageType = row.pageType;
    }
  }

  return [...clusters.values()]
    .map((cluster) => ({
      ...cluster,
      personas: [...cluster.personas].sort(),
      intents: [...cluster.intents].sort(),
      totalOpportunityScore: Number(cluster.totalOpportunityScore.toFixed(2)),
      queries: [...cluster.queries].sort((a, b) => b.opportunityScore - a.opportunityScore),
    }))
    .sort((a, b) => b.totalOpportunityScore - a.totalOpportunityScore);
}

function trimMetaDescription(value, max = 160) {
  const text = normalizeText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trim()}...`;
}

function createPageSpec(blueprint, row) {
  const keywordCluster = clusterKeywordRows(
    HIGH_ROI_QUERY_SEEDS.map((seed, index) => normalizeKeywordRow(seed, index))
  ).find((cluster) => cluster.pillar === blueprint.pillar);
  const description = trimMetaDescription(blueprint.heroSummary);
  const relatedPages = blueprint.relatedPaths.map((relatedPath) => {
    const related = PAGE_BLUEPRINTS.find((candidate) => candidate.path === relatedPath);
    return {
      path: relatedPath,
      title: related ? related.heroTitle : relatedPath,
    };
  });

  return {
    path: blueprint.path,
    slug: blueprint.path.split('/').filter(Boolean).join('-'),
    query: row.query,
    pillar: blueprint.pillar || row.pillar,
    intent: row.intent,
    pageType: blueprint.pageType,
    persona: row.persona,
    opportunityScore: row.opportunityScore,
    title: blueprint.title,
    description,
    heroTitle: blueprint.heroTitle,
    heroSummary: blueprint.heroSummary,
    takeaways: blueprint.takeaways,
    sections: blueprint.sections,
    faq: blueprint.faq,
    relatedPages,
    cta: {
      label: 'Go Pro — $19/mo',
      href: `/checkout/pro?utm_source=website&utm_medium=seo_page&utm_campaign=${blueprint.path.split('/').filter(Boolean).join('_')}&cta_placement=seo_brief&plan_id=pro`,
    },
    proofLinks: [
      { label: 'Verification evidence', href: PRODUCT.verificationUrl },
      { label: 'Automation proof', href: PRODUCT.automationUrl },
      ...(blueprint.path === '/guides/agent-harness-optimization'
        ? [{ label: 'Harness proof', href: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/proof/harnesses-report.json' }]
        : []),
      { label: 'GitHub repository', href: PRODUCT.repoUrl },
    ],
    changefreq: blueprint.pageType === 'comparison' ? 'weekly' : 'monthly',
    priority: blueprint.pageType === 'comparison' ? '0.9' : '0.8',
    keywordCluster: keywordCluster ? keywordCluster.queries.slice(0, 4).map((item) => item.query) : [row.query],
    imageAlt: `${PRODUCT.name} guide for ${blueprint.heroTitle}`,
  };
}

function buildThumbGateSeoPlan(rawRows = HIGH_ROI_QUERY_SEEDS) {
  const capture = rawRows.map((row, index) => normalizeKeywordRow(row, index));
  const clusters = clusterKeywordRows(capture);
  const rowsByQuery = new Map(capture.map((row) => [row.query.toLowerCase(), row]));
  const pages = PAGE_BLUEPRINTS.map((blueprint) => {
    const row = rowsByQuery.get(blueprint.query.toLowerCase()) || normalizeKeywordRow({
      query: blueprint.query,
      businessValue: 90,
      source: 'blueprint',
    });
    return createPageSpec(blueprint, row);
  }).sort((a, b) => b.opportunityScore - a.opportunityScore);

  const briefs = pages.map((page, index) => ({
    priority: index + 1,
    path: page.path,
    title: page.title,
    primaryQuery: page.query,
    persona: page.persona,
    pageType: page.pageType,
    opportunityScore: page.opportunityScore,
    cta: page.cta,
    keywordCluster: page.keywordCluster,
    summary: page.heroSummary,
  }));

  return {
    framework: 'GSD',
    capture: {
      keywordRows: capture,
      totalKeywords: capture.length,
    },
    clarify: {
      intents: capture.reduce((acc, row) => {
        acc[row.intent] = (acc[row.intent] || 0) + 1;
        return acc;
      }, {}),
      personas: capture.reduce((acc, row) => {
        acc[row.persona] = (acc[row.persona] || 0) + 1;
        return acc;
      }, {}),
      pageTypes: capture.reduce((acc, row) => {
        acc[row.pageType] = (acc[row.pageType] || 0) + 1;
        return acc;
      }, {}),
    },
    organize: {
      clusters,
      topClusters: clusters.slice(0, 4),
    },
    execute: {
      briefs,
      pages,
    },
    review: {
      topOpportunityQuery: capture.slice().sort((a, b) => b.opportunityScore - a.opportunityScore)[0],
      recommendedOrder: briefs.map((brief) => brief.path),
      proofAssets: PRODUCT.proofPoints,
    },
  };
}

function renderPlanMarkdown(plan) {
  const lines = [
    '# ThumbGate SEO/GEO GSD Plan',
    '',
    `Framework: ${plan.framework}`,
    '',
    '## Capture',
    '',
    `- Total keyword rows: ${plan.capture.totalKeywords}`,
    ...plan.capture.keywordRows.map((row) => `- ${row.query} | intent=${row.intent} | pillar=${row.pillar} | score=${row.opportunityScore}`),
    '',
    '## Clarify',
    '',
    `- Intents: ${Object.entries(plan.clarify.intents).map(([key, value]) => `${key}=${value}`).join(', ')}`,
    `- Personas: ${Object.entries(plan.clarify.personas).map(([key, value]) => `${key}=${value}`).join(', ')}`,
    `- Page types: ${Object.entries(plan.clarify.pageTypes).map(([key, value]) => `${key}=${value}`).join(', ')}`,
    '',
    '## Organize',
    '',
    ...plan.organize.topClusters.map((cluster) => `- ${cluster.pillar}: ${cluster.primaryQuery.query} (${cluster.totalOpportunityScore})`),
    '',
    '## Execute',
    '',
    ...plan.execute.briefs.map((brief) => (
      `### ${brief.priority}. ${brief.title}\n\n- Path: ${brief.path}\n- Primary query: ${brief.primaryQuery}\n- Persona: ${brief.persona}\n- Page type: ${brief.pageType}\n- Opportunity score: ${brief.opportunityScore}\n- CTA: ${brief.cta.label}\n- Summary: ${brief.summary}`
    )),
    '',
    '## Review',
    '',
    `- Top opportunity query: ${plan.review.topOpportunityQuery.query}`,
    `- Recommended publish order: ${plan.review.recommendedOrder.join(', ')}`,
    `- Proof assets: ${plan.review.proofAssets.join(', ')}`,
    '',
  ];
  return lines.join('\n');
}

function writePlanOutputs(plan, outputDir = DEFAULT_OUTPUT_DIR) {
  fs.mkdirSync(outputDir, { recursive: true });
  const files = {
    capture: path.join(outputDir, '01-capture.json'),
    clarify: path.join(outputDir, '02-clarify.json'),
    organize: path.join(outputDir, '03-organize.json'),
    execute: path.join(outputDir, '04-execute-briefs.md'),
    review: path.join(outputDir, '05-review.json'),
    pages: path.join(outputDir, '06-page-specs.json'),
  };

  fs.writeFileSync(files.capture, `${JSON.stringify(plan.capture, null, 2)}\n`);
  fs.writeFileSync(files.clarify, `${JSON.stringify(plan.clarify, null, 2)}\n`);
  fs.writeFileSync(files.organize, `${JSON.stringify(plan.organize, null, 2)}\n`);
  fs.writeFileSync(files.execute, `${renderPlanMarkdown(plan)}\n`);
  fs.writeFileSync(files.review, `${JSON.stringify(plan.review, null, 2)}\n`);
  fs.writeFileSync(files.pages, `${JSON.stringify(plan.execute.pages, null, 2)}\n`);
  return files;
}

function renderFaqJsonLd(page) {
  if (!Array.isArray(page.faq) || page.faq.length === 0) return '';
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: page.faq.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }, null, 2);
}

function renderWebPageJsonLd(page, runtimeConfig) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: page.heroTitle,
    description: page.description,
    about: page.keywordCluster,
    url: `${runtimeConfig.appOrigin}${page.path}`,
    publisher: {
      '@type': 'Organization',
      name: PRODUCT.name,
      url: runtimeConfig.appOrigin,
    },
    mainEntityOfPage: `${runtimeConfig.appOrigin}${page.path}`,
  }, null, 2);
}

function renderSeoPageHtml(page, runtimeConfig = {}) {
  const appOrigin = normalizeText(runtimeConfig.appOrigin) || PRODUCT.homepageUrl;
  const canonicalUrl = `${appOrigin}${page.path}`;
  const relatedCards = page.relatedPages.map((related) => `
        <a class="related-card" href="${escapeHtml(related.path)}">
          <span class="related-label">Related page</span>
          <strong>${escapeHtml(related.title)}</strong>
        </a>`).join('');
  const takeaways = page.takeaways.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const sections = page.sections.map((section) => `
      <section class="detail-section">
        <h2>${escapeHtml(section.heading)}</h2>
        ${(section.paragraphs || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
        ${(section.bullets && section.bullets.length) ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>` : ''}
      </section>`).join('');
  const faq = page.faq.map((item) => `
      <details class="faq-item">
        <summary>${escapeHtml(item.question)}</summary>
        <p>${escapeHtml(item.answer)}</p>
      </details>`).join('');
  const proofLinks = page.proofLinks.map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a>`).join('');
  const faqJsonLd = renderFaqJsonLd(page);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.description)}" />
  <meta property="og:title" content="${escapeHtml(page.title)}" />
  <meta property="og:description" content="${escapeHtml(page.description)}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <link rel="llm-context" href="/public/llm-context.md" type="text/markdown" />
  <link rel="icon" type="image/svg+xml" href="/thumbgate-icon.png" />
  <link rel="apple-touch-icon" href="/assets/brand/thumbgate-mark.svg" />
  <meta property="og:image" content="/og.png" />
  <style>
    :root {
      --bg: #0a0a0b;
      --bg-raised: #111113;
      --bg-card: #161618;
      --line: #222225;
      --text: #e8e8ec;
      --muted: #8b8b96;
      --cyan: #22d3ee;
      --green: #4ade80;
      --red: #f87171;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.65;
    }
    a { color: var(--cyan); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .container { max-width: 980px; margin: 0 auto; padding: 0 24px; }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      backdrop-filter: blur(12px);
      background: rgba(10, 10, 11, 0.88);
      border-bottom: 1px solid var(--line);
    }
    .topbar .container {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 14px;
      padding-bottom: 14px;
    }
    .brand {
      font-weight: 700;
      color: var(--text);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
    }
    .brand .logo-mark { width: 28px; height: 28px; display: block; }
    .hero { padding: 72px 0 32px; }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid rgba(34, 211, 238, 0.22);
      background: rgba(34, 211, 238, 0.1);
      color: var(--cyan);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 12px;
      font-weight: 700;
    }
    h1 {
      font-size: clamp(34px, 5vw, 56px);
      line-height: 1.06;
      letter-spacing: -0.04em;
      margin: 16px 0;
      max-width: 760px;
    }
    .hero p {
      max-width: 720px;
      color: var(--muted);
      font-size: 18px;
    }
    .signal-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin: 28px 0 0;
    }
    .signal-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--bg-raised);
      font-weight: 600;
      font-size: 14px;
    }
    .signal-pill.up {
      border-color: rgba(74, 222, 128, 0.28);
      color: #b8f7c8;
      background: rgba(74, 222, 128, 0.1);
    }
    .signal-pill.down {
      border-color: rgba(248, 113, 113, 0.28);
      color: #ffc0c0;
      background: rgba(248, 113, 113, 0.1);
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
      gap: 24px;
      padding-bottom: 72px;
    }
    .card, .detail-section, .sidebar-card {
      background: var(--bg-card);
      border: 1px solid var(--line);
      border-radius: 16px;
    }
    .card { padding: 24px; }
    .detail-section { padding: 24px; margin-bottom: 18px; }
    .detail-section h2 { margin: 0 0 12px; font-size: 24px; letter-spacing: -0.03em; }
    .detail-section p { color: var(--muted); }
    .detail-section ul, .card ul { padding-left: 18px; color: var(--muted); }
    .card h2 { margin-top: 0; }
    .sidebar {
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .sidebar-card {
      padding: 20px;
    }
    /* Only the first sidebar card sticks. Stacking multiple stickies at the
       same top offset makes them overlap each other on scroll. The related-
       pages card flows normally below. */
    .sidebar-card:first-child {
      position: sticky;
      top: 84px;
      max-height: calc(100vh - 104px);
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
    }
    .proof-links {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 16px;
    }
    .cta-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-top: 18px;
      padding: 12px 16px;
      border-radius: 10px;
      background: var(--cyan);
      color: #071116;
      font-weight: 700;
      text-decoration: none;
    }
    .faq-item {
      border-top: 1px solid var(--line);
      padding: 14px 0;
    }
    .faq-item summary {
      cursor: pointer;
      font-weight: 600;
    }
    .faq-item p {
      color: var(--muted);
    }
    .related-card {
      display: block;
      padding: 14px;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: var(--bg-raised);
      margin-top: 12px;
      color: var(--text);
    }
    .related-label {
      display: block;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 4px;
    }
    @media (max-width: 860px) {
      .grid {
        grid-template-columns: 1fr;
      }
      .sidebar-card:first-child {
        position: static;
        max-height: none;
        overflow: visible;
      }
    }
  </style>
  <script type="application/ld+json">
${renderWebPageJsonLd(page, { appOrigin })}
  </script>
  ${faqJsonLd ? `<script type="application/ld+json">\n${faqJsonLd}\n  </script>` : ''}
</head>
<body>
  <div class="topbar">
    <div class="container">
      <a class="brand" href="/"><img src="/assets/brand/thumbgate-mark-inline.svg" alt="ThumbGate" class="logo-mark" width="28" height="28"><span class="logo-text">ThumbGate</span></a>
      <a href="${escapeHtml(PRODUCT.verificationUrl)}" target="_blank" rel="noopener">Verification evidence</a>
    </div>
  </div>

  <main class="container">
    <section class="hero">
      <div class="eyebrow">${escapeHtml(page.pageType)} | ${escapeHtml(page.query)}</div>
      <h1>${escapeHtml(page.heroTitle)}</h1>
      <p>${escapeHtml(page.heroSummary)}</p>
      <div class="signal-row">
        <div class="signal-pill up">👍 Thumbs up reinforces good behavior</div>
        <div class="signal-pill down">👎 Thumbs down blocks repeated mistakes</div>
      </div>
    </section>

    <section class="grid">
      <div>
        <div class="card">
          <h2>Why this page exists</h2>
          <ul>${takeaways}</ul>
        </div>
        ${sections}
        <div class="detail-section">
          <h2>FAQ</h2>
          ${faq}
        </div>
      </div>

      <aside class="sidebar">
        <div class="sidebar-card">
          <h2>GSD execution brief</h2>
          <p>This page was prioritized because it captures high-intent demand around ${escapeHtml(page.query)} and feeds directly into ThumbGate's proof-led conversion path.</p>
          <p><strong>Opportunity score:</strong> ${page.opportunityScore}</p>
          <p><strong>Primary persona:</strong> ${escapeHtml(page.persona)}</p>
          <p><strong>Keyword cluster:</strong> ${escapeHtml(page.keywordCluster.join(', '))}</p>
          <p><strong>Pricing:</strong> Pro $19/mo or $149/yr. Team $49/seat/mo.</p>
          <div class="proof-links">${proofLinks}</div>
          <a class="cta-button" href="${escapeHtml(page.cta.href)}" target="_blank" rel="noopener">${escapeHtml(page.cta.label)}</a>
        </div>
        <div class="sidebar-card">
          <h2>Related pages</h2>
          ${relatedCards}
        </div>
      </aside>
    </section>
  </main>
</body>
</html>`;
}

const THUMBGATE_SEO_PLAN = buildThumbGateSeoPlan(HIGH_ROI_QUERY_SEEDS);
const THUMBGATE_SEO_PAGE_SPECS = THUMBGATE_SEO_PLAN.execute.pages;
const THUMBGATE_SEO_SITEMAP_ENTRIES = THUMBGATE_SEO_PAGE_SPECS.map((page) => ({
  path: page.path,
  changefreq: page.changefreq,
  priority: page.priority,
}));

function findSeoPageByPath(pathname) {
  return THUMBGATE_SEO_PAGE_SPECS.find((page) => page.path === pathname) || null;
}

function parseArgs(argv) {
  const args = { command: 'full', write: false, input: null, outDir: DEFAULT_OUTPUT_DIR };
  const tokens = argv.slice(2);
  for (const token of tokens) {
    if (token === 'plan' || token === 'full') {
      args.command = token;
      continue;
    }
    if (token === '--write') {
      args.write = true;
      continue;
    }
    if (token.startsWith('--input=')) {
      args.input = token.slice('--input='.length);
      continue;
    }
    if (token.startsWith('--out-dir=')) {
      args.outDir = path.resolve(token.slice('--out-dir='.length));
      continue;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const rows = args.input ? loadKeywordRows(args.input) : HIGH_ROI_QUERY_SEEDS;
  const plan = buildThumbGateSeoPlan(rows);

  if (args.write) {
    const files = writePlanOutputs(plan, args.outDir);
    console.log(`Wrote SEO GSD outputs to ${args.outDir}`);
    for (const filePath of Object.values(files)) {
      console.log(`  - ${path.relative(ROOT, filePath)}`);
    }
  }

  if (args.command === 'plan' || args.command === 'full') {
    console.log(renderPlanMarkdown(plan));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_OUTPUT_DIR,
  HIGH_ROI_QUERY_SEEDS,
  PAGE_BLUEPRINTS,
  PRODUCT,
  THUMBGATE_SEO_PLAN,
  THUMBGATE_SEO_PAGE_SPECS,
  THUMBGATE_SEO_SITEMAP_ENTRIES,
  buildThumbGateSeoPlan,
  classifyIntent,
  clusterKeywordRows,
  createPageSpec,
  findSeoPageByPath,
  inferPageType,
  inferPersona,
  inferPillar,
  loadKeywordRows,
  normalizeKeywordRow,
  parseCsv,
  renderPlanMarkdown,
  renderSeoPageHtml,
  scoreOpportunity,
  writePlanOutputs,
};
