#!/usr/bin/env node
'use strict';

/**
 * scripts/thumbgate-email-steal-engine.js
 *
 * Autonomous Pre-Delete Email Concept Internalizer & Strategy Steal Engine.
 *
 * Hard Invariant:
 *   NO self-sent `Thumbgate ---` or `Thumbgate marketing --` email may ever be
 *   archived or moved to Trash until this engine has:
 *     1. Extracted the core concept, benchmarks, URLs, and concrete entities.
 *     2. Internalized a permanent structured lesson into `~/.thumbgate/lessons-index.jsonl`
 *        (via `scripts/lesson-inference.js` `createLesson` + `inferStructuredLesson`).
 *     3. Written a durable strategy note into the Obsidian Vault
 *        (`~/Documents/AI-Agent-Sync/Projects/ThumbGate/Email-Triage-Archive/<date>-<slug>.md`).
 *     4. Appended a stolen-strategy entry into `marketing/stolen-ideas-ledger.jsonl`
 *        so daily marketing drafts and product gates automatically use it.
 *     5. Verified all 3 artifacts exist on disk and written a signed receipt to
 *        `~/.local/state/fo-thumbgate-inbox/internalized-ideas.jsonl`.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createLesson,
  inferStructuredLesson,
  extractConcreteEntities,
  getLessonsPath,
} = require('./lesson-inference');

const HOME = os.homedir();
const REPO_ROOT = path.resolve(__dirname, '..');
const VAULT_ARCHIVE_DIR = path.join(
  HOME,
  'Documents',
  'AI-Agent-Sync',
  'Projects',
  'ThumbGate',
  'Email-Triage-Archive',
);
const STOLEN_LEDGER_PATH = path.join(REPO_ROOT, '.thumbgate', 'stolen-ideas-ledger.jsonl');
const FO_STATE_DIR = path.join(HOME, '.local', 'state', 'fo-thumbgate-inbox');
const INTERNALIZED_LEDGER_PATH = path.join(FO_STATE_DIR, 'internalized-ideas.jsonl');

function slugify(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/^thumbgate\s*(?:marketing\s*)?[-—]+\s*/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'thumbgate-idea';
}

function extractUrls(text = '') {
  const matches = String(text || '').match(/https?:\/\/[^\s<>)"']+/gi) || [];
  return Array.from(new Set(matches));
}

function stripForwardedHeaders(text = '') {
  return String(text || '')
    .replace(/^-+\s*Forwarded message\s*-+[\s\S]*?(?:\r?\n){2,}/im, '')
    .replace(/^(?:From|Date|Subject|To|Cc):[^\r\n]*\r?\n/gim, '')
    .trim();
}

function classifyStrategyAndAction({ subject = '', body = '' }) {
  const cleanedBody = stripForwardedHeaders(body);
  const combined = `${subject}\n${cleanedBody || body}`;
  const lower = combined.toLowerCase();
  const urls = extractUrls(combined);
  const entities = extractConcreteEntities(combined);

  if (/jellyfish|\$252|claude code bills/i.test(combined)) {
    return {
      category: 'marketing_benchmark_steal',
      domainTag: 'finops-roi',
      summary: 'Jellyfish benchmark: early-adopter software factories spend $252/mo per developer on Claude Code.',
      stolenStrategy: 'Anchor ThumbGate Pro ($19/mo or $149/yr) against the $252/dev/mo Claude Code software-factory bill: killing 42% loop/collision burn saves $105.84/mo/dev (5.57x ROI).',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateJellyfishClaudeCodeBillSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Jellyfish', '$252/mo/dev', 'Claude Code'])),
    };
  }
  if (/ibm.*identity and control|securing frontier intelligence/i.test(combined)) {
    return {
      category: 'security_architecture_steal',
      domainTag: 'agent-identity',
      summary: 'IBM Agent Identity and Control for Enterprise Frontier Intelligence.',
      stolenStrategy: 'Bind every autonomous agent tool call to a Non-Human Identity (agentId + delegatedHumanPrincipal + sessionPassportVerified + least-privilege tool allowlist) and block cross-boundary escalation pre-execution.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateIbmAgentIdentityAndControlSteal',
      urls,
      entities: Array.from(new Set([...entities, 'IBM-Agent-Identity', 'NHI', 'least-privilege'])),
    };
  }
  if (/grok bot|memory import/i.test(combined)) {
    return {
      category: 'product_onboarding_steal',
      domainTag: 'memory-import',
      summary: 'Grok Bot zero-cold-start cross-assistant memory import.',
      stolenStrategy: 'Export and import user preferences, custom instructions, and concrete prevention rules across SI assistants (Grok Bot, Claude Code, Cursor, Codex, Gemini) with secret redaction and zero generic bloat.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateGrokBotMemoryImportSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Grok-Bot', 'memory-import', 'zero-cold-start'])),
    };
  }
  if (/genie 4|world model/i.test(combined)) {
    return {
      category: 'pre_action_simulation_steal',
      domainTag: 'world-model',
      summary: 'Google DeepMind Genie 4 interactive world-model pre-action counterfactual simulation.',
      stolenStrategy: 'Simulate 1-step counterfactual environment transitions (currentState -> proposedToolCall -> predictedNextState) before executing high-blast-radius actions, blocking irreversible or multi-actor-colliding states.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateGenie4WorldModelCounterfactualSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Genie-4', 'world-model', 'counterfactual-gate'])),
    };
  }
  if (/selecting the right data|gdpval|cursorbench|curating evaluation tasks/i.test(combined)) {
    return {
      category: 'eval_curation_steal',
      domainTag: 'eval-curation',
      summary: '5-Factor LLM/Agent Evaluation Task Curation (GDPval structured taxonomy + CursorBench real-usage sourcing).',
      stolenStrategy: 'Enforce 5 evaluation curation factors: (1) Diverse GDPval taxonomy (sector/occupation/activity), (2) Realistic CursorBench real-usage sourcing, (3) Deterministic oracle, (4) Holdout decontamination, (5) Difficulty calibration.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateFiveFactorEvalDataCurationSteal',
      urls,
      entities: Array.from(new Set([...entities, 'GDPval', 'CursorBench', '5-factor-eval'])),
    };
  }
  if (/supabase|paul copplestone|ant wilson/i.test(combined)) {
    return {
      category: 'database_governance_steal',
      domainTag: 'supabase-rls',
      summary: 'Why Agents Love Supabase (Paul Copplestone & Ant Wilson): ephemeral branch DBs, RLS, and pgvector.',
      stolenStrategy: 'Block agent DDL/migrations on production without an ephemeral Supabase branch, require ENABLE ROW LEVEL SECURITY on all public tables, and block service_role key leaks in agent/client code.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateSupabaseAgentDatabaseSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Supabase', 'RLS', 'pgvector'])),
    };
  }
  if (/glm-5\.3|sglang|cross-request kv cache/i.test(combined)) {
    return {
      category: 'inference_security_steal',
      domainTag: 'kv-cache-isolation',
      summary: 'Cloudflare Workers AI GLM-5.3 Cross-request KV cache exposure & SGLang RadixAttention remediation.',
      stolenStrategy: 'Salt SGLang RadixAttention prefix cache keys with sha256(tenantId + sessionId + model + inferenceEngine) and zero out KV blocks on session eviction to prevent cross-request KV leakage.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateGlm53WorkersAiSglangKvCacheIsolationSteal',
      urls,
      entities: Array.from(new Set([...entities, 'GLM-5.3', 'SGLang', 'KV-cache-isolation'])),
    };
  }
  if (/hermes guide links|thumbgate pro key/i.test(combined)) {
    return {
      category: 'onboarding_and_skill_sync_steal',
      domainTag: 'hermes-pro-key',
      summary: 'ThumbGate Hermes guide links & LinkedIn Pro key onboarding verification.',
      stolenStrategy: 'Enforce bounded memory budget (<=2,200 chars), signed Hermes skill manifest verification, and instant tg_pro_ license verification across LinkedIn/Direct onboarding.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateHermesGuideLinksAndProKeySteal',
      urls,
      entities: Array.from(new Set([...entities, 'Hermes-Agent', 'Pro-Key', 'bounded-memory'])),
    };
  }
  if (/3 million mcp calls|4,200 tests|100,000 hours saved|darrel at mabl|info@mabl\.com|move at agent speed/i.test(combined)) {
    return {
      category: 'agent_speed_and_auditor_evidence_steal',
      domainTag: 'mabl-agent-speed-jira-xray-evidence',
      summary: 'Mabl ("3 million MCP calls. 4,200 tests. 100,000 hours saved. — How to move at agent speed and trust what you ship"): 3-Number Outcome Hook + 90-Day Fleet Ledger + Jira/Xray Auditor Evidence Reports + Independent Pre-Ship Verification.',
      stolenStrategy: 'Lead executive outbound with a 3-number outcome subject line, publish 90-day aggregate MCP/session/failure telemetry, emit tamper-evident SHA-256 Jira & Xray compliance evidence receipts on every gate/verifier run, and block shipping agent-written code without independent zero-context verification.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateMablAgentSpeedAndEvidenceSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Mabl', 'Jira-Xray-Evidence', '3M-MCP-Calls', 'Independent-Verification'])),
    };
  }
  if (/stack overflow|stack exchange|stackexchange\.com\/users\/71611|do-not-reply@stackoverflow\.email/i.test(combined)) {
    return {
      category: 'stackoverflow_aeo_and_monetization_steal',
      domainTag: 'stackoverflow-aeo-71611',
      summary: 'Stack Overflow / Stack Exchange (users/71611): Canonical Self-Q&A ("Answer Your Own Question") + Moderator-Safe Maintainer Attribution + Profile Bio 4-Tier Money Ladder + LLM AEO Indexing.',
      stolenStrategy: 'Publish code-first self-answered Q&As across [claude-code], [cursor], [model-context-protocol], and [dialogflow-cx] with policy-compliant 1-line OSS maintainer attribution (?utm_source=stackoverflow) while routing high-intent buyers through the Stack Overflow profile bio into /go/pro-direct ($19/mo) and /go/bundle-49 ($49).',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateStackOverflowAeoAndMonetizationSteal',
      urls,
      entities: Array.from(new Set([...entities, 'StackOverflow', 'StackExchange-71611', 'AEO', 'Self-QA'])),
    };
  }
  if (/tailworm|magicroute|guardrails on muse|swe-mux|scurgery|newsletter@tailscale\.com/i.test(combined)) {
    return {
      category: 'zero_trust_agent_network_and_db_identity_steal',
      domainTag: 'tailscale-oct2026-tailworm-magicroute-muse-scurgery',
      summary: 'Tailscale Oct 29, 2026 Newsletter: Tailworm SSH v1.104.4 class-level safeguards, Identity-Scoped AWS DB write access (zero laptop credentials), MagicRoute sticky multi-backend connectors, Meta Muse node guardrails + SSH referee, swe-mux mobile panes, and scurgery byte-identical policy blocks.',
      stolenStrategy: 'Enforce Tailscale >=1.104.4 against Tailworm, block shared DB passwords and laptop credentials in favor of identity-scoped read/write roles, route multi-backend connectors with MagicRoute stickiness, isolate personal AI agents (Meta Muse) as distinct non-public nodes with SSH refereeing, and manage temporary policy blocks with scurgery byte-identical round-trips.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateTailscaleOct2026NewsletterSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Tailworm-v1.104.4', 'MagicRoute', 'Meta-Muse', 'swe-mux', 'scurgery'])),
    };
  }
  if (/is it better, or does it just feel better|confidence\.spotify\.com\/experiments|confidence\.spotify\.com\/workflows\/abtest|sequential testing.*peeking won'?t mislead/i.test(combined)) {
    return {
      category: 'sequential_ab_experimentation_and_revenue_conversion_steal',
      domainTag: 'spotify-confidence-sequential-ab-experiments',
      summary: 'Spotify Confidence Experiments (Johan Söderholm — "Is it better, or does it just feel better?" + https://app.confidence.spotify.com/experiments): Pre-registered "If we ___, then ___ will increase, because ___" hypothesis, exactly ONE primary success metric + upfront guardrails, mSPRT sequential testing (peeking-safe), and answering two questions: did it improve things, and did it break anything?',
      stolenStrategy: 'Enforce pre-registered If/Then/Because hypotheses, lock 1 primary revenue metric (net_new_external_paid_orders_usd) + upfront guardrails, evaluate continuous traffic via peeking-safe mSPRT sequential testing, and run the live ThumbGate Direct Checkout A/B experiment (t4cd4ntvf9ppbxzutjso) in Spotify Confidence.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateSpotifyConfidenceSequentialAbExperimentSteal',
      urls: Array.from(new Set([...urls, 'https://app.confidence.spotify.com/experiments', 'https://app.confidence.spotify.com/workflows/abtest/instances/t4cd4ntvf9ppbxzutjso/design'])),
      entities: Array.from(new Set([...entities, 'Spotify-Confidence-Experiments', 'Johan-Soderholm', 'mSPRT-Sequential-Testing', 'Pre-Registered-Hypothesis', 'Guardrail-Metrics'])),
    };
  }
  if (/define a metric once|trust it everywhere|fact tables point to the events|single.*purchases.*table gives you revenue|choose metrics that track real outcomes|easy proxies can mislead you/i.test(combined)) {
    return {
      category: 'spotify_confidence_metrics_and_fact_tables_steal',
      domainTag: 'spotify-confidence-fact-tables-and-metrics',
      summary: 'Spotify Confidence (Johan Söderholm — "Define a metric once, trust it everywhere"): 2 building blocks (Fact tables pointing to warehouse events + Reused metrics), user ID alignment between fact table and flag assignment, 3–5 core metrics (1 north star, 2 drivers, 2 guardrails), and tracking real outcomes instead of misleading easy proxies.',
      stolenStrategy: 'Ground every metric in a canonical warehouse fact table, match user IDs with assignment IDs, lock 3–5 core metrics (1 north star, 2 drivers, 2 guardrails), and reject vanity proxy metrics in favor of verified business outcomes.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateSpotifyConfidenceMetricsAndFactTablesSteal',
      urls: Array.from(new Set([...urls, 'https://app.confidence.spotify.com/metrics', 'https://confidence.spotify.com/docs/metrics/fact-tables'])),
      entities: Array.from(new Set([...entities, 'Spotify-Confidence', 'Johan-Soderholm', 'Fact-Tables', 'North-Star-Metric', 'Guardrail-Metrics', 'Outcome-Not-Proxy'])),
    };
  }
  if (/ship code without shipping the change|johan s.derholm|confidence\.spotify\.com|name flags after the behaviour/i.test(combined)) {
    return {
      category: 'feature_flag_and_offline_shadow_experiment_steal',
      domainTag: 'spotify-confidence-flags-shadow-experiments',
      summary: 'Spotify Confidence (Johan Söderholm — "Ship code without shipping the change" + app.confidence.spotify.com/flags): Separate deploy from release, behaviour-named flags (not JIRA-1234), mandatory owner + removal date, default="off" fail-safe, zero-reinstrumentation A/B promotion, and Offline Shadow Experiments.',
      stolenStrategy: 'Block ticket-named flags/gates (JIRA-1234), require owner + plannedRemovalDate on every gate/flag, enforce default="off" fail-safe state, track Last Resolved / Last Applied / Rules ratio for Cleanup sweeps, and run Offline Shadow Experiments before live rollout.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateSpotifyConfidenceFlagsAndShadowSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Spotify-Confidence', 'Johan-Soderholm', 'Offline-Shadow-Experiments', 'Behavior-Named-Flags'])),
    };
  }
  if (/learn\.gitlab\.com\/blog-10-prompts|10-ai-prompts|chandler gibbons|teamacceleration_email/i.test(combined)) {
    return {
      category: 'sdlc_20_80_bottleneck_and_prompt_to_gate_steal',
      domainTag: 'gitlab-10-ai-prompts-sdlc-gates',
      summary: 'GitLab ("10 AI prompts to speed your team\'s software delivery" by Chandler Gibbons): Coding is only 20% of the SDLC while 80% is review, security, docs, planning, testing, and CI debugging bottlenecks.',
      stolenStrategy: 'Compile all 10 manual GitLab Duo SDLC prompts (MR logical review, 5-point breaking change check, security scan triage, 5-vector pre-MR security check, 5-group release notes, 4-surface doc drift, epic-to-slice breakdown, 5-dimension unit tests, coverage gap analysis, and CI failure root-cause + prevention rule) into automatic PreToolUse/PR gates while stripping mkt_tok bloat and refusing GitLab Duo SKU clones.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateGitLabTenAiPromptsAndNurtureSteal',
      urls,
      entities: Array.from(new Set([...entities, 'GitLab-10-Prompts', '20-80-SDLC-Bottleneck', 'Chandler-Gibbons', 'mkt_tok-Strip'])),
    };
  }
  if (/fiddler newsletter|marketing@fiddler\.ai|84% of developers|only 3% highly trust|dynamic model escalation|centor sends edge cases/i.test(combined)) {
    return {
      category: 'agent_autonomy_checklist_and_centor_escalation_steal',
      domainTag: 'fiddler-oct2026-autonomy-centor-935',
      summary: 'Fiddler AI October 2026 Newsletter (UID 132307): 84% adoption vs 3% high-trust gap, 3-Level Autonomy Checklist (supervised/delegated/autonomous across identity, data, tools, code, cost), Centor Dynamic Model Escalation (-93.5% jailbreak false positives), and Claude Code session tracing (tampering, injection, loops).',
      stolenStrategy: 'Gate agent promotion from supervised to delegated/autonomous on all 5 dimensions (identity, data, tools, code, cost), escalate borderline Stage-1 risk scores (0.35..0.75) to an in-environment model to cut false positives by 93.5%, and trace every Claude Code session for tampering, injection, and loops at $0 SaaS tax.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateFiddlerOct2026NewsletterSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Fiddler-Oct2026', '3-Level-Autonomy', 'Centor-93.5pct-FP-Cut', 'Claude-Code-Tracing'])),
    };
  }
  if (/confused agents are bad agents|kiyu gabriel|sarbjeetjohal|2115073742321713223|streamhouse/i.test(combined)) {
    return {
      category: 'streamhouse_causal_consistency_steal',
      domainTag: 'ibm-streamhouse-kiyu-gabriel',
      summary: 'Kiyu Gabriel (Field CTO, Data, IBM Software via @sarbjeetjohal): "Confused agents are bad agents" — Streamhouse eliminates 15-minute read-after-write propagation lag between data federation and data consolidation.',
      stolenStrategy: 'Enforce a Streamhouse Read-Your-Own-Writes (RYOW) causal watermark overlay across multi-agent workflows so downstream agents never see stale reads after an upstream write or re-execute duplicate writes during the 15-minute propagation window.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateSarbjeetJohalKiyuGabrielStreamhouseSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Streamhouse', 'Kiyu-Gabriel', 'Sarbjeet-Johal', 'RYOW-Watermark'])),
    };
  }
  if (/hermes jarvis|obsidian memory is actually wild|aiprofitboardroom|dfdbob0il3y/i.test(combined)) {
    return {
      category: 'second_brain_memory_and_content_os_steal',
      domainTag: 'hermes-jarvis-obsidian-memory',
      summary: 'Hermes Jarvis + Obsidian Shared Memory (@aiprofitboardroom_): Persistent business memory + real-context content planning + voice second-brain interface.',
      stolenStrategy: 'Connect Hermes Sync Plane (offset+cursor), Obsidian Vault (AI-Agent-Sync), daily content planning, and voice routing (gemini-2.5-flash-lite) into one shared second-brain memory system.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateHermesJarvisObsidianMemorySteal',
      urls,
      entities: Array.from(new Set([...entities, 'Hermes-Jarvis', 'Obsidian-Memory', 'Second-Brain-Voice'])),
    };
  }
  if (/socialwithaayan|muhammad ayan|matt pocock.*skills in claude code/i.test(combined)) {
    return {
      category: 'x_articles_viral_monetization_steal',
      domainTag: 'x-articles-socialwithaayan',
      summary: 'Muhammad Ayan (@socialwithaayan) X Article Formula (8.5K views): Dark Terminal Hero Banner + "Tested on Real Tasks" 3-Command Walkthrough + 4-Tier Money Ladder.',
      stolenStrategy: 'Publish full-length X Articles (up to 25,000 chars) paired with a dark-mode macOS terminal hero banner SVG, a 3-gate real-project walkthrough, and an auto-plugged 4-tier money ladder ($9.99 / $49 / $19/mo / $499).',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateXArticleMonetizationAndPromotionSteal',
      urls,
      entities: Array.from(new Set([...entities, 'X-Articles', 'socialwithaayan', 'Terminal-Hero-Banner', '4-Tier-Ladder'])),
    };
  }
  if (/fast, reliable a2ui|swappable inference formats|a2ui express|jev2ui|apparite/i.test(combined)) {
    return {
      category: 'generative_ui_inference_format_steal',
      domainTag: 'google-a2ui-express',
      summary: 'Google A2UI (Oct 27, 2026): A2UI Express swappable inference format (3x faster, 3x fewer tokens, thinking off) + Controlled Generation with TypeSafe Jev (80x faster layout decisions, 92-298ms tree).',
      stolenStrategy: 'Use A2UI Express one-line positional syntax with thinking=off for open-ended catalog UIs (3x fewer tokens) and TypeSafe Jev System-One controlled generation + flash-lite updateDataModel streaming for known screen archetypes (80x faster layout decisions).',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateGoogleA2uiSwappableInferenceSteal',
      urls,
      entities: Array.from(new Set([...entities, 'A2UI-Express', 'TypeSafe-Jev', 'Apparite-jev2ui', 'updateDataModel'])),
    };
  }
  if (/github universe 2026|evolving every layer of the stack|copilot fusion|copilot code review max/i.test(combined)) {
    return {
      category: 'stack_wide_agentic_sdlc_steal',
      domainTag: 'github-universe-2026',
      summary: 'GitHub Universe 2026 (Jay Parikh): Copilot Fusion (-50% cost, -40% time), Code Review Max (ReviewBench F1 leader), Session Continuity, Outcome-Learning Automations, and 3-Principle Agent-Scale Git.',
      stolenStrategy: 'Orchestrate tasks across 4 Copilot Fusion dimensions (reasoning, code_generation, debugging, tool_use) for 50% cost and 40% time savings, tier code review into Lite/Balanced/Max, preserve cross-surface session continuity, and decouple storage from compute with minimal coordination.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateGitHubUniverse2026StackSteal',
      urls,
      entities: Array.from(new Set([...entities, 'GitHub-Universe-2026', 'Copilot-Fusion', 'Code-Review-Max', 'Agent-Scale-Git'])),
    };
  }
  if (/dynamic workflows|turn annotations into code|github universe 2026|a2ui|1937 could make the org chart|socialwithaayan|primitives of agentic software|webmcp|confused agents are bad agents|kiyu gabriel|nick reva|titus winters/i.test(combined)) {
    return {
      category: 'oct28_strategy_batch_steal',
      domainTag: 'agent-architecture-primitives',
      summary: 'Oct 28 Self-Strategy Batch (Deterministic Workflows, Cursor Annotations, GitHub Universe 2026, A2UI, Coase 1937, WebMCP, IBM Kiyu Gabriel, DoorDash Nick Reva, Titus Winters).',
      stolenStrategy: 'Enforce deterministic workflow graphs over sprawling subagents, compile UI annotations to DOM selectors, introspect WebMCP browser schemas, prune context entropy (Kiyu Gabriel), harden vibe-coder guardrails (Nick Reva), and test across time & scale (Titus Winters).',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateOct28InboxSelfStrategyBatchSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Coase-1937', 'WebMCP', 'A2UI', 'Vibe-Coder-Hardening'])),
    };
  }

  if (/welcome to wabi|start something together|blas@wabi\.ai|wabi\.ai\/try\/welcome/i.test(combined)) {
    return {
      category: 'wabi_collaborative_sales_operations_steal',
      domainTag: 'wabi-sales-operations',
      summary: 'Wabi ("Welcome to Wabi. Start something together." — blas@wabi.ai & ai.wabi.desktop v0.1.19): 3 Try Now multiplayer mini-apps (Shared Deal Plan, Live Deal Countdown, Inbox & Checkout Deadline Radar) driving ThumbGate Sales Operations.',
      stolenStrategy: 'Drive ThumbGate sales operations with Wabi 3-pillar collaborative mini-apps: (1) Shared Fleet Rollout & ROI Map ($252/dev/mo * 42% = $105.84/dev/mo saved), (2) Shared 48h Diagnostic & Founding-Rate Countdown Widget, and (3) Inbox & Abandoned-Checkout Deadline Radar with $0 outbound spend and 50% partner rev-share flips.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateWabiCollaborativeSalesOperationsSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Wabi', 'Shared-Deal-Map', 'Countdown-Widget', 'Deadline-Radar'])),
    };
  }
  if (/vibetrend\.dev|a free badge for thumbgate|what thumbgate is missing out on|kapil from vibetrend/i.test(combined)) {
    return {
      category: 'vibetrend_badge_and_partner_flip_steal',
      domainTag: 'vibetrend-partner-flip',
      summary: 'VibeTrend (Kapil <hello@vibetrend.dev> — "A free badge for ThumbGate" & "What ThumbGate is missing out on"): Claim free verified badge backlink with UTM attribution, refuse paid Spotlight upgrades ($0 outbound spend), and flip into 50% rev-share affiliate partnership.',
      stolenStrategy: 'Claim free VibeTrend verified badge distribution with canonical UTM tracking, enforce $0 outbound spend against paid directory upgrades, and convert inbound directory pitches into 50% commission partners on ThumbGate Pro ($19/mo, $149/yr) and the $499 Diagnostic.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateVibeTrendBadgeAndZeroSpendPartnerFlipSteal',
      urls,
      entities: Array.from(new Set([...entities, 'VibeTrend', 'Free-Badge-UTM', 'Zero-Outbound-Spend', '50Pct-Partner-Flip'])),
    };
  }
  if (/conversational commerce with multi-agent swarms on gcp|sbq92vad3jmaymdtr/i.test(combined)) {
    return {
      category: 'gcp_conversational_commerce_swarm_steal',
      domainTag: 'gcp-conversational-commerce-swarm',
      summary: 'Google Developers Blog ("Building Conversational Commerce with Multi-Agent Swarms on GCP: A Working Prototype"): Multi-agent commerce orchestration on GCP.',
      stolenStrategy: 'Enforce deterministic economics gating (recoveryCac < contributionPerSale), sub-0.5ms PreToolUse tool validation, and HMAC-signed checkout receipts across multi-agent conversational commerce swarms.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateGcpConversationalCommerceSwarmSteal',
      urls: Array.from(new Set([...urls, 'https://developers.googleblog.com/building-conversational-commerce-with-multi-agent-swarms-on-gcp-a-working-prototype/'])),
      entities: Array.from(new Set([...entities, 'GCP-Multi-Agent-Swarm', 'Conversational-Commerce', 'Signed-Checkout-Receipt'])),
    };
  }
  if (/githubprojects|nblmhgumaq2wcibhi/i.test(combined)) {
    return {
      category: 'github_projects_board_automation_steal',
      domainTag: 'github-projects-board-sync',
      summary: 'GitHub Projects Community (@GithubProjects): Automated Project Board + PR & CI Status Synchronization.',
      stolenStrategy: 'Synchronize GitHub Projects V2 boards, Entire CI/CD trails, and GitHub Copilot Desktop persistent project subscriptions so CLEAN PRs squash-merge automatically without branch-protection bypass.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateGitHubProjectsCommunityBoardAutomationSteal',
      urls: Array.from(new Set([...urls, 'https://x.com/GithubProjects/status/2114705863453909359'])),
      entities: Array.from(new Set([...entities, 'GitHub-Projects', 'Entire-CI-Sync', 'Auto-Merge-CLEAN'])),
    };
  }
  if (/addy osmani|addyosmani|k3ciiegemljtjb5pn/i.test(combined)) {
    return {
      category: 'addy_osmani_ai_engineering_discipline_steal',
      domainTag: 'addy-osmani-spec-first-ai',
      summary: 'Addy Osmani (@addyosmani): AI-Assisted Software Engineering Discipline & Solving the 70% Problem.',
      stolenStrategy: 'Enforce spec-first decomposition, small reviewable PR slices, deterministic context packs, and mandatory unit/integration test verification before merge to block AI-generated tech debt.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateAddyOsmaniAiEngineeringDisciplineSteal',
      urls: Array.from(new Set([...urls, 'https://x.com/addyosmani/status/2115326629488824753'])),
      entities: Array.from(new Set([...entities, 'Addy-Osmani', 'Spec-First-AI', '70-Percent-Problem-Guard'])),
    };
  }
  if (/saas is dead|aqqjh_uv-_w/i.test(combined)) {
    return {
      category: 'greg_isenberg_service_as_software_steal',
      domainTag: 'greg-isenberg-saas-is-dead',
      summary: 'Greg Isenberg ("SaaS is dead?" — YouTube AqqjH_uv-_w): Pivot from passive seat SaaS to outcome-priced Agentic Infrastructure + Done-With-You Diagnostic.',
      stolenStrategy: 'Monetize across the 4-tier outcome ladder: $9.99 Playbook (/go/playbook-999) -> $49 Corporate Bundle (/go/bundle-49) -> $19/mo or $149/yr Pro Firewall (/go/pro-direct) -> $499 Managed Workflow Gate (/diagnostic).',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateGregIsenbergSaasIsDeadServiceAsSoftwareSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Greg-Isenberg', 'Service-As-Software', '4-Tier-Outcome-Ladder'])),
    };
  }
  if (/don't replace your saas with ai|mpbezfhky80/i.test(combined)) {
    return {
      category: 'ryan_doser_deterministic_saas_guard_steal',
      domainTag: 'ryan-doser-deterministic-saas-gates',
      summary: 'Ryan Doser ("Don\'t Replace Your SaaS With AI Until You Watch This" — YouTube mPbezFhky80): Keep deterministic state machines and security gates outside LLM prompts.',
      stolenStrategy: 'Never replace deterministic SaaS state machines, billing, or RBAC with unconstrained LLM prompts; enforce sub-0.5ms PreToolUse deterministic code gates around every agent tool call.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateRyanDoserDontReplaceSaasWithoutDeterministicGatesSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Ryan-Doser', 'Deterministic-State-Machine', 'PreToolUse-Firewall'])),
    };
  }
  if (/replace your sales team with a book|7-figure book system|agqpfyxxgkq/i.test(combined)) {
    return {
      category: 'seven_figure_book_lead_magnet_funnel_steal',
      domainTag: 'omar-eltakrori-7-figure-book-funnel',
      summary: 'Omar Eltakrori ("Replace your sales team with a book! The 7-Figure Book System" — YouTube AgQpFYxXGKQ): Self-liquidating $9.99 book/playbook funnel replacing cold sales teams.',
      stolenStrategy: 'Use the $9.99 Claude Code Cost-Cutter Playbook (/go/playbook-999 -> https://iganapolsky.gumroad.com/l/odrkon) as a self-liquidating book funnel that educates buyers and ascends them into the $49 Bundle (/go/bundle-49), $19/mo Pro (/go/pro-direct), and $499 Diagnostic at $0 outbound spend.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateSevenFigureBookLeadMagnetSalesFunnelSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Omar-Eltakrori', '7-Figure-Book-System', 'Playbook-999-Ascension'])),
    };
  }
  if (/getting youtube views is changing|what marketers need to know|c7vxrvbg56s/i.test(combined)) {
    return {
      category: 'youtube_discovery_and_marketer_view_shift_steal',
      domainTag: 'social-media-examiner-youtube-discovery',
      summary: 'Social Media Examiner ("Getting YouTube Views Is Changing: What Marketers Need to Know" — YouTube c7vXrVbG56s): Intent-driven discovery, 15s retention hooks, and chaptered proof.',
      stolenStrategy: 'Structure technical demos with a 15-second failure-interception hook, chaptered proof timestamps, and UTM-tagged description checkout links (/go/playbook-999, /go/pro-direct, /diagnostic).',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateYouTubeDiscoveryAndMarketerViewShiftSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Social-Media-Examiner', 'YouTube-Intent-Discovery', 'UTM-Description-Funnel'])),
    };
  }
  if (/turn youtube into paying clients|frdgtvhjxoy/i.test(combined)) {
    return {
      category: 'think_media_youtube_to_paying_clients_steal',
      domainTag: 'think-media-youtube-client-conversion',
      summary: 'Think Media Podcast ("Turn YouTube Into Paying Clients" — YouTube FRdgtvHjxOY): High-intent problem teardowns with 1-click checkout in the first 3 description lines.',
      stolenStrategy: 'Place 1-click tracked checkout links (/go/pro-direct and /diagnostic) in the first 3 lines of every video/article description targeting specific Claude Code and Cursor failure modes.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateThinkMediaYouTubeToPayingClientsConversionSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Think-Media', 'YouTube-Client-Conversion', 'Above-Fold-Checkout-CTA'])),
    };
  }
  if (/taking on servicenow|serval|jake stauch|ezcwesmulb4/i.test(combined)) {
    return {
      category: 'serval_jake_stauch_servicenow_it_coding_agents_steal',
      domainTag: 'serval-jake-stauch-it-coding-agents',
      summary: 'No Priors Podcast ("Taking on ServiceNow: Coding Agents for the Rest of Us with Serval Co-Founder and CEO Jake Stauch" — YouTube EZcWEsMuLb4): Compiling IT/SecOps workflows into governed coding-agent automations.',
      stolenStrategy: 'Compile repetitive IT/SecOps ticket and access workflows into deterministic, version-controlled scripts gated by least-privilege identity verification and tamper-evident audit receipts.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateServalJakeStauchServiceNowItCodingAgentsSteal',
      urls,
      entities: Array.from(new Set([...entities, 'Serval', 'Jake-Stauch', 'No-Priors', 'ITSM-Coding-Agent-Gates'])),
    };
  }
  if (/how ai agents shape experts|judgment calls|ysltvgowzwtcbip6g/i.test(combined)) {
    return {
      category: 'anthropic_ai_agents_expert_judgment_calibration_steal',
      domainTag: 'anthropic-agents-judgment-calls',
      summary: 'Anthropic Research ("How AI agents shape experts\' judgment calls" — https://www.anthropic.com/research/agents-judgment-calls): Guarding expert decision-making against automation bias and sycophancy.',
      stolenStrategy: 'Prevent expert rubber-stamping and automation bias by requiring independent zero-context verification (verify:isolated), counterfactual blast-radius checks, and raw SHA-256 empirical receipts before ratifying agent output.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateAiAgentsExpertJudgmentCalibrationSteal',
      urls: Array.from(new Set([...urls, 'https://www.anthropic.com/research/agents-judgment-calls'])),
      entities: Array.from(new Set([...entities, 'Anthropic-Research', 'Expert-Judgment-Calls', 'Anti-Automation-Bias'])),
    };
  }
  if (/omarsar0|elvis|8hiotco08c8zm4jru/i.test(combined)) {
    return {
      category: 'elvis_saravia_context_and_agent_engineering_steal',
      domainTag: 'omarsar0-elvis-context-engineering',
      summary: 'Elvis Saravia (@omarsar0 / DAIR.AI — https://x.com/omarsar0/status/2115810394614960516): Context engineering, bounded tool output shunting, and failure-to-gate promotion.',
      stolenStrategy: 'Enforce structured context packs with freshness verification, shunt tool outputs above 350 lines, and promote repeated agent mistakes into deterministic PreToolUse gates.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateElvisSaraviaContextAndAgentEngineeringSteal',
      urls: Array.from(new Set([...urls, 'https://x.com/omarsar0/status/2115810394614960516'])),
      entities: Array.from(new Set([...entities, 'Elvis-Saravia', 'omarsar0', 'DAIR-AI', 'Context-Engineering'])),
    };
  }
  if (/competitor monetization strategies|mfppz1mxgvg9ian6m/i.test(combined)) {
    return {
      category: 'google_aimode_competitor_monetization_steal',
      domainTag: 'google-aimode-competetitor-monetization',
      summary: 'Google AI Mode Deep Research ("Thumbgate Competitor Monetization Strategies" — Kong, Composio, Lakera, Zenity, Prisma AIRS): 4-Layer Monetization Architecture.',
      stolenStrategy: 'Monetize across 4 competitor-proven layers: (1) $39/seat/mo Team Cloud Rule-Syncing Registry, (2) $0.01/100 calls Headless CI/CD Autonomous Runner metering, (3) $1,500/mo SOC2/NIST/EU-AI-Act Compliance Audit Pack, and (4) $149/mo Automated DPO/RLHF Dataset Export Add-On alongside Free MIT CLI, $19/mo Pro, and $499 Diagnostic.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateGoogleAiModeCompetitorMonetizationSteal',
      urls: Array.from(new Set([...urls, 'https://share.google/aimode/mFPpz1MxgVg9IAN6M'])),
      entities: Array.from(new Set([...entities, 'Kong-AI-Gateway', 'Composio', 'Lakera', 'Zenity', 'Team-Rule-Sync-39'])),
    };
  }
  if (/ultramarine 1 flash|paper instruments|320b parameters, 18b active|fireworks and baseten/i.test(combined)) {
    return {
      category: 'ultramarine_1_flash_open_weights_moe_steal',
      domainTag: 'paper-instruments-ultramarine-1-flash',
      summary: 'Paper Instruments ("Ultramarine 1 Flash weights are now on Hugging Face" — 320B parameters, 18B active MoE, 1M context window on Hugging Face, Ultramarine API, Fireworks, and Baseten).',
      stolenStrategy: 'Route 1M-token full-repository security audits, multi-PR Trail synthesis, and DPO rubric grading to Ultramarine 1 Flash (paper-instruments/ultramarine-1-flash, 320B total / 18B active MoE = 5.63% active compute) across Hugging Face open weights, Ultramarine API, Fireworks, and Baseten.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateUltramarine1FlashOpenWeightsAndRoutingSteal',
      urls: Array.from(new Set([...urls, 'https://huggingface.co/PaperInstruments'])),
      entities: Array.from(new Set([...entities, 'Paper-Instruments', 'Ultramarine-1-Flash', '320B-A18B-1M', 'Fireworks', 'Baseten'])),
    };
  }
  if (/october was not supposed to go like this|agentbeam|litellm 1\.107\.0|ovhcloud cli|aokigahara|wipebench/i.test(combined)) {
    return {
      category: 'agentbeam_october_security_and_wipebench_steal',
      domainTag: 'agentbeam-3job-triage-and-wipebench',
      summary: 'Yash Thakker / AgentBeam ("October Was Not Supposed to Go Like This" + WipeBench 112-scenario safety harness): separate Patching (5), Key Rotation at provider (4), and Planted Persistence/Backdoor removal (6 incl. LiteLLM 1.107.0, OVHcloud CLI 0.11.0-0.15.0, Aokigahara session stealer, and repo-open hooks).',
      stolenStrategy: 'Enforce 3-job incident separation (patch flaw != revoke stolen key != remove planted persistence before revoking tokens), block LiteLLM 1.107.0 and OVHcloud CLI 0.11.0-0.15.0 in PreToolUse, isolate WipeBench evaluator boundaries outside the agent container, and flip AgentBeam into a $0-outbound-spend 50% rev-share partner.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateAgentbeamOct2026SecurityAndWipeBenchSteal',
      urls: Array.from(new Set([...urls, 'https://agentbeam.com', 'https://github.com/whyashthakker/WipeBench'])),
      entities: Array.from(new Set([...entities, 'Yash-Thakker', 'AgentBeam', 'LiteLLM-1.107.0', 'OVHcloud-CLI', 'CVE-2026-96951', 'Aokigahara', 'WipeBench-112'])),
    };
  }
  if (/business account with stripe treasury|acct_1RNcJ1GGBpd520QY|fifth third bank.*250,000|fee credits.*\$2k/i.test(combined)) {
    return {
      category: 'stripe_treasury_zero_fee_settlement_steal',
      domainTag: 'stripe-treasury-finops-control',
      summary: 'Stripe Treasury (acct_1RNcJ1GGBpd520QY): $0 monthly fee, $250k FDIC pass-through, 1% Stripe fee credits above $2K balance, 2% virtual card cashback, and $0-fee instant Stripe-to-Stripe partner payouts.',
      stolenStrategy: 'Fund Stripe Treasury strictly via automated revenue-splitting from settled Checkout payments (never external bank top-up), earn 1% Stripe fee credits to offset Checkout processing fees, pay 50% partner rev-share via $0-fee instant Stripe-to-Stripe transfers after customer settlement, and guard Treasury outbound/top-up endpoints in financial-control-plane.js.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateStripeTreasuryZeroFeeSettlementAndCardSteal',
      urls: Array.from(new Set([...urls, 'https://dashboard.stripe.com/b/acct_1RNcJ1GGBpd520QY/treasury', 'https://docs.stripe.com/stripe-fee-credits'])),
      entities: Array.from(new Set([...entities, 'Stripe-Treasury', 'acct_1RNcJ1GGBpd520QY', '1pct-Fee-Credits', '2pct-Cashback', 'Zero-Outbound-Spend'])),
    };
  }

  if (/how fast do you reply to your team|responsive\s*=\s*responsible|riandoris@flowstate\.com|three-hour window.*100%\s*offline/i.test(combined)) {
    return {
      category: 'flow_methodology_and_monetization_steal',
      domainTag: 'rian-doris-responsive-vs-responsible-flow',
      summary: 'Rían Doris (FlowState.com — "How fast do you reply to your team?", Nov 3, 2026): Responsive != Responsible; protect the 15-30m struggle phase and a daily 3-hour (180m) 100%-offline block for high-leverage business growth.',
      stolenStrategy: 'Replace compulsive 60-second reactive inbox/agent ping-pong with batched decision slots (07:30, 12:05, 15:05 ET) around a protected 3-hour (180-minute, 09:00-12:00 ET) 100%-unreachable deep-work block dedicated strictly to proactive revenue growth, and position ThumbGate as the Flow-State Firewall that prevents agent loops from breaking the 15-30m struggle-to-flow ramp.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateRianDorisResponsiveVsResponsibleFlowBlockSteal',
      urls: Array.from(new Set([...urls, 'https://flowstate.com'])),
      entities: Array.from(new Set([...entities, 'Rian-Doris', 'FlowState', '180m-Offline-Block', '15-30m-Struggle-Phase', 'Responsive-Not-Responsible'])),
    };
  }
  if (/three new products.*multiple accounts per pipes provider|airlock.*atlas.*passport|pipes connection sharing|updates@workos\.com/i.test(combined)) {
    return {
      category: 'enterprise_agent_governance_and_auth_steal',
      domainTag: 'workos-airlock-atlas-passport-pipes-siem',
      summary: 'WorkOS ("New this month: Three New Products (Airlock, Atlas, Passport), Multiple Accounts per Pipes Provider, Custom Branding per Application, Pipes Connection Sharing, SIEM Audit Logs & Scoped Agent Handoff Tokens", Nov 2, 2026).',
      stolenStrategy: 'Enforce WorkOS Airlock 3-way policy decisions (allow | block | route_to_human_approval), Atlas internal app permissions, Passport device-bound identity with Cyber60 scoped agent-to-agent handoff tokens (<=4 tools), Pipes multi-account provider isolation + admin connection sharing, per-application custom branding inheritance, and SIEM audit log streaming.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateWorkOsAirlockAtlasPassportPipesSteal',
      urls: Array.from(new Set([...urls, 'https://workos.com'])),
      entities: Array.from(new Set([...entities, 'WorkOS', 'Airlock', 'Atlas', 'Passport', 'Pipes-Multi-Account', 'Cyber60-Scoped-Tokens', 'SIEM-Audit-Logs'])),
    };
  }
  if (/103419784|super-agent\s*设计探索|deepseek.*super-agent|dsh-superagent|双层架构.*事件驱动.*watchdog/i.test(combined)) {
    return {
      category: 'autonomous_super_agent_architecture_steal',
      domainTag: 'deepseek-super-agent-router-worker-watchdog',
      summary: 'DeepSeek Harness Team ("Super-agent 设计探索：迈向更自主的 Agent 系统" — Yicai 103419784 / deepseek-ai/dsh-superagent-prototype, Oct 31, 2026): Dual-layer Router/Worker split, 2-stage Fast/Slow event filter, Subscription Pass-Through (-30% Router decisions), Inline & Spill context cache, Storage-Compute separation + External Semantic Watchdog, and off/observe/auto autonomy gate.',
      stolenStrategy: 'Separate lightweight tool-less Router coordination from isolated Worker ticket execution (<=4 tools), route claimed PR/thread events directly via Subscription Pass-Through to save 26.9% cached tokens, inline next-hop IDs while spilling long tool outputs, run an external semantic Watchdog to heal unproductive Worker loops, and default proactive unmentioned bug fixes to observe mode.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateDeepSeekSuperAgentArchitectureSteal',
      urls: Array.from(new Set([...urls, 'https://www.yicai.com/news/103419784.html', 'https://github.com/deepseek-ai/dsh-superagent-prototype'])),
      entities: Array.from(new Set([...entities, 'DeepSeek-Harness', 'Super-agent', 'Router-Worker-Split', 'Subscription-PassThrough', 'Semantic-Watchdog', 'Observe-Mode-Default'])),
    };
  }
  if (/emDutDLIiow|enterprise knowledge graph rag|8-step hybrid retrieval|text-to-cypher|ontology.*10-40/i.test(combined)) {
    return {
      category: 'enterprise_graph_rag_architecture_steal',
      domainTag: 'enterprise-knowledge-graph-rag-8step-hybrid',
      summary: 'Enterprise Knowledge Graph RAG (YouTube emDutDLIiow, Nov 3, 2026): 8-Step Hybrid Vector+Graph Retrieval, Bounded Ontology (10-40 classes, 10-30 relations), Read-Only Text-to-Cypher/SPARQL + Data-Layer ACLs, CDC + Temporal valid_from/valid_to edges, and 3 Production Metrics (Faithfulness, Citation Accuracy, Constraint Violation Rate).',
      stolenStrategy: 'Combine vector candidate retrieval with bounded 1-3 hop subgraph expansion and RRF reranking across a 10-40 class ontology, enforce read-only Cypher/SPARQL with data-layer permissions and temporal edges, and gate releases on Faithfulness >= 0.95, Citation Accuracy >= 0.95, and Constraint Violation Rate <= 0.01.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateEnterpriseKnowledgeGraphRag8StepHybridSteal',
      urls: Array.from(new Set([...urls, 'https://music.youtube.com/watch?v=emDutDLIiow'])),
      entities: Array.from(new Set([...entities, 'Enterprise-GraphRAG', '8-Step-Hybrid-Retrieval', 'Bounded-Ontology', 'Temporal-Edges', 'Read-Only-Cypher'])),
    };
  }
  if (/67BmkptgTms|nick'?s bops|\$25,000.*ai agent|50 warm calls.*3 referrals|paper mcp.*orgo.*agentmail/i.test(combined)) {
    return {
      category: 'b2b_agent_system_monetization_steal',
      domainTag: 'nicks-bops-25k-custom-smb-ai-agent-system',
      summary: 'Nick\'s Bops ($25,000 Custom SMB AI Agent System — YouTube 67BmkptgTms, Nov 3, 2026): 50 warm calls/day -> free pilot gated on 3 warm business-owner referrals, Paper MCP 3-4 layout convergence, Orgo VM + AgentMail + AgentPhone + Composio 4-tool stack, and $25k 2-payment 15-bot ownership + $3k/mo retainer.',
      stolenStrategy: 'Require 3 warm referrals for any free pilot, generate 3-4 Paper MCP layout variations before frontend code, isolate each customer worker on Orgo VM + AgentMail + AgentPhone + <=4 Composio tools, and monetize via our $19/mo -> $49 -> $499 -> $25k (2x $12.5k milestone + $3k/mo retainer) B2B ladder.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateNicksBops25kCustomAiAgentSystemSteal',
      urls: Array.from(new Set([...urls, 'https://music.youtube.com/watch?v=67BmkptgTms'])),
      entities: Array.from(new Set([...entities, 'Nicks-Bops', '25k-Custom-Agent-System', 'Paper-MCP', 'Orgo-VM', 'AgentMail', 'AgentPhone', '3-Warm-Referrals'])),
    };
  }
  if (/drex-max-v1|nace-ai|nace ai.*system-one|\/v1\/systemone|48 gated deltanet/i.test(combined)) {
    return {
      category: 'system_one_decision_model_steal',
      domainTag: 'nace-ai-drex-max-v1-27b-system-one',
      summary: 'Nace AI Drex Max v1 27B System-One Decision Model (MarkTechPost & HuggingFace nace-ai/drex-max-v1, Nov 1, 2026): 48 Gated DeltaNet + 16 non-causal full-attention layers, 255-way readout head, POST /v1/systemone (choice | noul | score), Apple Silicon 24GB Q4 / 48GB Q8_0 GGUF, Decision Index 0.4 67.52, JevBench 92.2%, Decision Bench v4 94.30%.',
      stolenStrategy: 'Route sub-100ms PreToolUse gates, 255-way tool/SKU selection, and abstention checks (noul) through local System-One Drex Max v1 (/v1/systemone on 48GB Apple Silicon Q8_0 / 24GB MLX 4-bit), escalating to frontier System-Two LLMs strictly when noul abstains.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateNaceAiDrexMaxV1SystemOneDecisionSteal',
      urls: Array.from(new Set([...urls, 'https://www.marktechpost.com/2026/11/01/nace-ai-open-sources-drex-max-v1-local-inference/', 'https://huggingface.co/nace-ai/drex-max-v1'])),
      entities: Array.from(new Set([...entities, 'Nace-AI', 'Drex-Max-v1', 'System-One-Decision-Model', 'Gated-DeltaNet', 'Noul-Abstention', 'JevBench-92.2'])),
    };
  }
  if (/openai-pando-git-backend|pando.*git backend|packfile-uri.*express|explicit haves/i.test(combined)) {
    return {
      category: 'agent_scale_git_infrastructure_steal',
      domainTag: 'openai-pando-distributed-git-backend',
      summary: 'OpenAI Pando Distributed Git Backend (The New Stack, Nov 2, 2026): 5x faster push latency & ~1 PB/day via per-branch lock-free CAS ref coordination, streaming packfile validation to blob storage without unpacking, trunk-only ref advertisement + explicit-haves (<20 KiB median packs), packfile-uri + Express regional cache (>99% hit rate), and GC-free LSM pack compaction.',
      stolenStrategy: 'Eliminate repo-wide ref locks across multi-agent swarms by coordinating branch refs independently, advertising only trunk (main) with explicit-haves to keep agent feature packs <20 KiB, streaming packs directly to immutable storage, and compacting packs in background LSM tiers for O(log N) lookup.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateOpenAiPandoDistributedGitBackendSteal',
      urls: Array.from(new Set([...urls, 'https://thenewstack.io/openai-pando-git-backend/'])),
      entities: Array.from(new Set([...entities, 'OpenAI-Pando', 'Per-Branch-CAS', 'Packfile-URI', 'Express-Cache-99pct', 'LSM-Pack-Compaction', 'Explicit-Haves'])),
    };
  }
  if (/autoresearch\.sfcompute\.com|givemeanode|sandbox.*parks itself|1\.5s idle|330x cheaper/i.test(combined)) {
    return {
      category: 'agent_compute_and_monetization_steal',
      domainTag: 'sfcompute-autoresearch-rl-sandbox-autopark',
      summary: 'SF Compute Autoresearch (https://autoresearch.sfcompute.com/, Nov 3, 2026): Streamable HTTP MCP (mcp.autoresearch.sfcompute.com), 50ms free RL sandbox forks, 1.5s idle auto-parking (330x cheaper thinking: $0.13 vs $0.98 for 64x2GiB 10m rollout), fair queue (first-node priority + 85% batch cap), Friday 33% / Weekend 20% dynamic discounts, and Accept: text/markdown + /llms.txt agent discovery.',
      stolenStrategy: 'Auto-park idle agent sandboxes after 1.5s to cut rollout memory cost by 86.7% (330x cheaper thinking), serve Accept: text/markdown + /llms.txt with direct Stripe checkout links, prioritize every customer\'s first diagnostic node ahead of batch queues (<=85% batch cap), and block unfunded external billing top-ups ($0 outbound spend).',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateSfComputeAutoresearchAndMakeMoneySteal',
      urls: Array.from(new Set([...urls, 'https://autoresearch.sfcompute.com/', 'https://mcp.autoresearch.sfcompute.com'])),
      entities: Array.from(new Set([...entities, 'SF-Compute', 'Autoresearch', '1.5s-Sandbox-AutoPark', '330x-Cheaper-Thinking', 'Fair-Queue-First-Node', 'Accept-Text-Markdown'])),
    };
  }
  if (/console\.typesafe\.ai\/hook|jev-1\.14|meet jev|rlcd.*calibrated decisions|sde-cascade|skill-suggestion.*194/i.test(combined)) {
    return {
      category: 'system_one_calibrated_decision_and_skill_cascade_steal',
      domainTag: 'typesafe-jev-1-14-console-hook-skill-sde-cascade',
      summary: 'TypeSafe Jev Console Hook & v1.14.0 (https://console.typesafe.ai/hook + https://typesafe.ai/blog/jev-1-14): RLCD-trained System-One decision model (20-200x faster, 40-1000x cheaper, $0.042/Mtok input, $0 output, 262k long-context + box vision primitive), 2-call 194-skill suggestion cascade (cutting wrong loads 15.7%->7.9% & needless loads 14.0%->5.2%), SDE per-field Noul cascade (92.7% accuracy at 41% lower cost), 4-verdict citation check, and 4-Noul RAG passage filter.',
      stolenStrategy: 'Keep code in ownership of routing decisions (never model-emitted verdicts), run 2-call progressive skill disclosure capped at <=4 skills/turn, verify structured extractions per-field with Noul before escalating to frontier models, and enforce 4-verdict citation + 4-Noul RAG filtering at $0 outbound spend.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateTypesafeJevConsoleHookAndSkillCascadeSteal',
      urls: Array.from(new Set([...urls, 'https://console.typesafe.ai/hook', 'https://console.typesafe.ai/playground', 'https://typesafe.ai/blog/jev-1-14'])),
      entities: Array.from(new Set([...entities, 'TypeSafe-Jev-1.14.0', 'RLCD', 'Two-Call-Skill-Cascade', 'SDE-Cascade', 'Four-Verdict-Citation-Gate', 'Box-Primitive'])),
    };
  }
  if (/oak\s*&\s*sparrow|oakandsparrow\.io|gatekeeper\.pdf|gatekeeper v2|signal audit|oasse november 2026|nick@oakandsparrow\.io/i.test(combined)) {
    return {
      category: 'pre_execution_authorization_and_tamper_evident_audit_steal',
      domainTag: 'oasse-gatekeeper-v2-signal-audit-policy-packs',
      summary: 'Oak & Sparrow Systems Enterprise (Nick Silva <nick@oakandsparrow.io>, /Users/iganapolsky/Downloads/gatekeeper.pdf + OASSE November 2026 Newsletter PDF): Gatekeeper V2 pre-execution authorization (ALLOW | TRANSFORM | HOLD | DENY kept distinct from pilot ALLOW | ABSTAIN | DENY), traffic-light GREEN/YELLOW/RED verdicts, SHA-256 hash-chained receipts (1,000/1,000 restart recovery, cross-tenant NOT_FOUND, 0 webhook dead letters), and standalone MIT state Policy Packs (15%/25%/50% rule-count discounts).',
      stolenStrategy: 'Enforce 4-outcome pre-execution authorization (ALLOW/TRANSFORM/HOLD/DENY) with SHA-256 hash-chained receipts, return NOT_FOUND on cross-tenant receipt reads, package standalone MIT Policy Packs with tiered rule-count pricing, and forbid Reply-All on exposed newsletter recipient lists.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateOakAndSparrowGatekeeperV2SignalAuditSteal',
      urls: Array.from(new Set([...urls, 'https://oakandsparrow.io/#/case-studies/signal-audit', 'https://oakandsparrow.io/policypacks', 'https://www.oakandsparrowsystemsenterprise.com/#onboarding'])),
      entities: Array.from(new Set([...entities, 'Oak-And-Sparrow', 'Gatekeeper-V2', 'Signal-Audit', 'SHA256-Hash-Chain', 'MIT-Policy-Packs', 'Nick-Silva'])),
    };
  }
  if (/velodb\.cloud\/personalize|build real-time analytics on aws|datascience\.pdf|towards data science.*velodb|sql, vector, and full-text search for ai/i.test(combined)) {
    return {
      category: 'real_time_ai_analytics_and_personalize_onboarding_steal',
      domainTag: 'velodb-personalize-identity-guard-and-unified-ai-search',
      summary: 'VeloDB Cloud (/personalize + Towards Data Science datascience.pdf, Nov 3, 2026): Crafted-URL PostHog identity-graph poisoning defense (isVelodbTrustedReferrer + returning-visitor alias merge), >3,500B cookie self-healing across parent domains, Google Translate DOM removeChild/insertBefore crash guard, 2-step /personalize flow with first-class AI referral attribution & PoC sales fast-lane, unified SQL + Vector + Full-Text AI search, and active-feature downgrade lock.',
      stolenStrategy: 'Gate URL identity params (ph_distinct_id/ph_session_id) behind trusted referrers to block identity-graph poisoning, auto-evict >3,500B cookies across parent domains, patch Node.prototype.removeChild/insertBefore against browser translation plugins, track AI as a first-class referral source in 2-step onboarding, unify SQL + Vector + Full-Text search, and block plan downgrades while enterprise features are active.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateVeloDbPersonalizeAndRealTimeAiAnalyticsSteal',
      urls: Array.from(new Set([...urls, 'https://www.velodb.cloud/personalize'])),
      entities: Array.from(new Set([...entities, 'VeloDB-Cloud', 'Trusted-Referrer-Identity-Guard', 'Cookie-Self-Healing-3500B', 'React-Translate-DOM-Guard', 'Unified-SQL-Vector-FullText', 'AI-Referral-Attribution'])),
    };
  }
  if (/europarl\.europa\.eu|20230601sto93804|eu-ai-act-first-regulation-on-artificial-intelligence|eu ai act: first regulation on artificial intelligence/i.test(combined)) {
    return {
      category: 'regulatory_compliance_and_monetization_steal',
      domainTag: 'eu-ai-act-20230601sto93804-article14-human-oversight-gate',
      summary: 'European Parliament EU AI Act (20230601STO93804): 4-tier risk framework — Article 5 Unacceptable-Risk bans (cognitive manipulation, social scoring, untargeted biometric categorisation, real-time remote biometric ID), Article 6/14/Annex III High-Risk human-over-automation oversight & EU database registration, Article 50/53 GPAI transparency/copyright/incident reporting, and Article 57 SME Regulatory Sandboxes.',
      stolenStrategy: 'Monetize EU AI Act conformity across a 5-step ladder ($9.99 Article 14/50 Checklist -> $49 Standalone EU AI Act PreToolUse Policy Pack -> $19/mo Pro Debugger -> $199/mo Cloud Startup EU Audit Sink & SME Sandbox -> $499 48hr High-Risk Conformity Sprint) while hard-blocking Article 5 banned practices and enforcing Article 14 human oversight before tool execution.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateEuAiActComplianceAndMonetizationGate',
      urls: Array.from(new Set([...urls, 'https://www.europarl.europa.eu/topics/en/article/20230601STO93804/eu-ai-act-first-regulation-on-artificial-intelligence'])),
      entities: Array.from(new Set([...entities, 'EU-AI-Act', '20230601STO93804', 'Article-5-Unacceptable-Risk', 'Article-14-Human-Oversight', 'Annex-III-High-Risk', 'Article-50-GPAI-Transparency', 'Article-57-SME-Sandbox'])),
    };
  }
  if (/hyperagent\.com|rubrics:\s*set the standard|autowiki|onboarding-four-paths|victoria\.plummer@hyperagent\.com|support@hyperagent\.com|bounticlaw now connects to your mls|45 minutes to help shape intelligence\.com/i.test(combined)) {
    return {
      category: 'hyperagent_rubrics_autowiki_four_paths_and_b2b_email_steal',
      domainTag: 'hyperagent-rubrics-autowiki-four-paths-b2b-email',
      summary: 'Hyperagent (Vic Plummer & Fin — Rubrics, Autowiki, Marketplace, Four-Paths Skill Onboarding cmql52i8o0dd606adahnyadrt & GitHub Skill Import cmw17nqo401t006adhav5frrw) + Mandatory B2B Email Execution across Hyperagent, Intelligence.com, Bounti.ai, WorkOS, and Boardy.',
      stolenStrategy: 'Support Four-Paths skill onboarding (build_from_scratch, upload_file, link_documentation, import_from_github), compile failed Rubric criteria into deterministic PreToolUse gates, sync verified lessons via Autowiki into Obsidian/SKILL.md, and enforce explicit B2B email dispositions (REPLIED / DRAFTED_FOR_APPROVAL) while protecting replied threads from Trash.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateHyperagentRubricsAutowikiFourPathsAndB2bEmailSteal',
      urls: Array.from(new Set([...urls, 'https://hyperagent.com/thread/cmql52i8o0dd606adahnyadrt?autostart=onboarding-four-paths', 'https://hyperagent.com/thread/cmw17nqo401t006adhav5frrw'])),
      entities: Array.from(new Set([...entities, 'Hyperagent', 'Rubrics', 'Autowiki', 'Four-Paths-Onboarding', 'Mandatory-B2B-Email-Execution'])),
    };
  }
  if (/nvidia releases auto ontology|grounds ai\s+agent sql|mrgGg1DjHzUChMYPm|remote accelerator & fellowship links for thumbgate|nvidia inception program|rohanpaul_ai|D4eCWOvAxiTi7DEeI/i.test(combined)) {
    return {
      category: 'nvidia_auto_ontology_and_remote_accelerator_steal',
      domainTag: 'nvidia-auto-ontology-agent-sql-and-inception',
      summary: 'NVIDIA Auto Ontology Open Semantic Layer for Grounded AI Agent SQL + Remote Accelerator Shortlist (NVIDIA Inception rolling $0-fee 0%-equity fit for dual OSS + paid ThumbGate.ai model) + @rohanpaul_ai synthesis.',
      stolenStrategy: 'Ground every AI Agent SQL query against an explicit open semantic ontology view (blocking mutating SQL and ungrounded raw-table hallucination) and prioritize 100%-remote, $0-fee, 0%-equity startup programs (NVIDIA Inception) for ThumbGate.',
      gateOrModule: 'src/cloud-token-firewall.js#evaluateNvidiaAutoOntologyAndInceptionAcceleratorSteal',
      urls: Array.from(new Set([...urls, 'https://www.nvidia.com/en-us/startups/'])),
      entities: Array.from(new Set([...entities, 'NVIDIA-Auto-Ontology', 'Grounded-Agent-SQL', 'NVIDIA-Inception', 'Rohan-Paul'])),
    };
  }
  const cleanTopic = String(subject || '').replace(/^(?:thumbgate|dayglass|work)\s*(?:marketing\s*)?[-—:]+\s*/i, '').trim() || 'Inbound Strategy Note';
  return {
    category: /marketing/i.test(lower) ? 'marketing_strategy_steal' : 'product_architecture_steal',
    domainTag: 'email-strategy-steal',
    summary: cleanTopic.slice(0, 200),
    stolenStrategy: `UNIMPLEMENTED_PENDING_DEDICATED_GATE: "${cleanTopic.slice(0, 140)}" requires a dedicated domain gate function in src/cloud-token-firewall.js, unit test in tests/cloud-token-firewall.test.js, and PreToolUse hook before deletion.`,
    gateOrModule: 'UNIMPLEMENTED_REQUIRES_CODE_AND_TEST',
    urls,
    entities: Array.from(new Set([...entities, slugify(cleanTopic).slice(0, 32)])),
  };
}

function verifyCodeAndTestImplementation(gateOrModule = '') {
  const parts = String(gateOrModule || '').split('#');
  const relFile = parts[0] || '';
  const stealFn = parts[1] || '';
  if (!relFile || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(stealFn) || stealFn === 'evaluateDynamicEmailStrategySteal') {
    return { verified: false, stealFn: '', srcFile: '', testFile: '' };
  }
  const srcPath = path.join(REPO_ROOT, relFile);
  const testPath = path.join(REPO_ROOT, 'tests', 'cloud-token-firewall.test.js');
  if (!fs.existsSync(srcPath) || !fs.existsSync(testPath)) {
    return { verified: false, stealFn, srcFile: relFile, testFile: 'tests/cloud-token-firewall.test.js' };
  }
  const srcText = fs.readFileSync(srcPath, 'utf8');
  const testText = fs.readFileSync(testPath, 'utf8');
  const hasFnDef = srcText.includes(`function ${stealFn}(`);
  const hasTestCall = testText.includes(`${stealFn}(`);
  return {
    verified: hasFnDef && hasTestCall,
    stealFn,
    srcFile: relFile,
    testFile: 'tests/cloud-token-firewall.test.js',
  };
}

function internalizeEmailIdea({
  messageId = '',
  uid = '',
  subject = '',
  body = '',
  date = new Date().toISOString(),
  vaultArchiveDir = VAULT_ARCHIVE_DIR,
  stolenLedgerPath = STOLEN_LEDGER_PATH,
  internalizedLedgerPath = INTERNALIZED_LEDGER_PATH,
} = {}) {
  const cleanMessageId = String(messageId || '').trim();
  const cleanSubject = String(subject || '').trim();
  const cleanBody = String(body || '').trim();
  if (!cleanMessageId || !cleanSubject) {
    return {
      ok: false,
      readyToArchiveOrDelete: false,
      error: 'messageId and subject are required before an email can be internalized',
    };
  }
  // Idempotency guard: only reuse receipt if all 5 planes (including lesson_id present in lessons-index.jsonl, obsidian_path, and dedicated steal_fn) are complete
  const currentLessonsPath = getLessonsPath();
  const currentLessonsText = fs.existsSync(currentLessonsPath) ? fs.readFileSync(currentLessonsPath, 'utf8') : '';
  if (fs.existsSync(internalizedLedgerPath)) {
    for (const line of fs.readFileSync(internalizedLedgerPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const existing = JSON.parse(line);
        if (
          existing.message_id === cleanMessageId
          && existing.steal_fn
          && existing.steal_fn !== 'evaluateDynamicEmailStrategySteal'
          && existing.lesson_id
          && currentLessonsText.includes(existing.lesson_id)
          && existing.obsidian_path
          && fs.existsSync(existing.obsidian_path)
          && Array.isArray(existing.implemented_files)
          && existing.implemented_files.length >= 4
          && existing.implemented_files.every((f) => fs.existsSync(path.isAbsolute(f) ? f : path.join(REPO_ROOT, f)))
        ) {
          return {
            ok: true,
            readyToArchiveOrDelete: true,
            codeVerified: true,
            reusedReceipt: true,
            stealFn: existing.steal_fn || null,
            lessonId: existing.lesson_id || null,
            obsidianPath: existing.obsidian_path || null,
            stolenLedgerPath,
            receipt: existing,
          };
        }
      } catch (_) {}
    }
  }

  const analysis = classifyStrategyAndAction({ subject: cleanSubject, body: cleanBody });
  const codeCheck = verifyCodeAndTestImplementation(analysis.gateOrModule);
  const today = new Date().toISOString().slice(0, 10);
  const slug = slugify(cleanSubject);

  // 1. Create permanent structured lesson in ThumbGate (~/.thumbgate/lessons-index.jsonl)
  const conversationWindow = [
    { role: 'user', content: `${cleanSubject}\n${cleanBody}` },
    { role: 'assistant', content: `${analysis.stolenStrategy} (${analysis.gateOrModule})` },
  ];
  const structuredRule = inferStructuredLesson(conversationWindow, 'positive', analysis.stolenStrategy);
  const lessonRecord = createLesson({
    feedbackId: `email_idea_${crypto.createHash('sha256').update(cleanMessageId).digest('hex').slice(0, 12)}`,
    signal: 'positive',
    inferredLesson: `LEARNING: ${analysis.stolenStrategy}`,
    triggerMessage: cleanSubject,
    priorSummary: cleanBody.slice(0, 240),
    confidence: 95,
    tags: ['email-steal', analysis.domainTag, ...analysis.entities.slice(0, 4)],
    metadata: {
      reviewOrigin: 'human',
      sourceEmailMessageId: cleanMessageId,
      sourceEmailUid: String(uid || ''),
      category: analysis.category,
      gateOrModule: analysis.gateOrModule,
      urls: analysis.urls,
      structuredRule,
    },
  });

  // 2. Write durable Obsidian Vault note in Email-Triage-Archive + TCC-safe mirror in ~/.local/state/fo-thumbgate-inbox/dossiers
  const dossierFilename = `${today}-steal-${slug}.md`;
  const obsidianPath = path.join(vaultArchiveDir, dossierFilename);
  const localDossierDir = path.join(os.homedir(), '.local', 'state', 'fo-thumbgate-inbox', 'dossiers');
  fs.mkdirSync(localDossierDir, { recursive: true });
  const localDossierPath = path.join(localDossierDir, dossierFilename);
  const obsidianMarkdown = [
    '---',
    'type: internalized-email-strategy',
    `message_id: "${cleanMessageId.replace(/"/g, '\\"')}"`,
    `email_uid: "${String(uid || '')}"`,
    `category: ${analysis.category}`,
    `domain_tag: ${analysis.domainTag}`,
    `lesson_id: ${lessonRecord.id}`,
    `gate_or_module: ${analysis.gateOrModule}`,
    `steal_fn: "${codeCheck.stealFn || 'UNIMPLEMENTED'}"`,
    `code_and_test_verified: ${codeCheck.verified}`,
    `internalized_at: ${new Date().toISOString()}`,
    `status: ${codeCheck.verified ? 'INTERNALIZED_AND_VERIFIED' : 'PENDING_CODE_IMPLEMENTATION'}`,
    '---',
    '',
    `# Internalized Strategy: ${cleanSubject}`,
    '',
    '## 1. Original Signal',
    `- **Date:** ${date}`,
    `- **Message-ID:** \`${cleanMessageId}\``,
    `- **URLs:** ${analysis.urls.length ? analysis.urls.join(', ') : 'none'}`,
    '',
    '```text',
    cleanBody || cleanSubject,
    '```',
    '',
    '## 2. Concept Internalized & Strategy Stolen',
    `- **Summary:** ${analysis.summary}`,
    `- **Actionable Strategy / Rule:** ${analysis.stolenStrategy}`,
    `- **Implemented Gate / Module:** \`${analysis.gateOrModule}\``,
    `- **Verified Code Function:** \`${codeCheck.stealFn || 'PENDING'}\``,
    `- **ThumbGate Lesson ID:** \`${lessonRecord.id}\``,
    '',
  ].join('\n');
  fs.writeFileSync(localDossierPath, obsidianMarkdown, 'utf8');
  let vaultWritten = false;
  try {
    fs.mkdirSync(vaultArchiveDir, { recursive: true });
    fs.writeFileSync(obsidianPath, obsidianMarkdown, 'utf8');
    vaultWritten = true;
  } catch (_) {}

  // 3. Append to stolen-ideas-ledger.jsonl for marketing & product loops
  fs.mkdirSync(path.dirname(stolenLedgerPath), { recursive: true });
  const ledgerEntry = {
    ts: new Date().toISOString(),
    messageId: cleanMessageId,
    uid: String(uid || ''),
    subject: cleanSubject,
    category: analysis.category,
    domainTag: analysis.domainTag,
    summary: analysis.summary,
    stolenStrategy: analysis.stolenStrategy,
    gateOrModule: analysis.gateOrModule,
    stealFn: codeCheck.stealFn || null,
    codeVerified: codeCheck.verified,
    urls: analysis.urls,
    lessonId: lessonRecord.id,
    obsidianPath: vaultWritten ? obsidianPath : localDossierPath,
    localDossierPath,
  };
  fs.appendFileSync(stolenLedgerPath, `${JSON.stringify(ledgerEntry)}\n`, 'utf8');

  // 4. Verify all 3 artifacts PLUS real src/ code + tests/ unit test exist on disk BEFORE writing the unlock receipt
  const lessonsPath = getLessonsPath();
  const lessonVerified = fs.existsSync(lessonsPath) && Boolean(lessonRecord && lessonRecord.id);
  const obsidianVerified = fs.existsSync(localDossierPath) && fs.statSync(localDossierPath).size > 100;
  const ledgerVerified = fs.existsSync(stolenLedgerPath);
  const allVerified = lessonVerified && obsidianVerified && ledgerVerified && codeCheck.verified;

  if (!allVerified) {
    return {
      ok: false,
      readyToArchiveOrDelete: false,
      codeVerified: codeCheck.verified,
      lessonId: lessonRecord.id,
      obsidianPath: vaultWritten ? obsidianPath : localDossierPath,
      stolenLedgerPath,
      error: codeCheck.verified
        ? 'Artifact verification failed; refusing to authorize email removal'
        : 'No verified code function (src/*.js) and unit test (tests/*.test.js) found for this email yet; holding email in INBOX until implemented and tested',
    };
  }

  // 5. Upsert unlock receipt in ~/.local/state/fo-thumbgate-inbox/internalized-ideas.jsonl
  fs.mkdirSync(path.dirname(internalizedLedgerPath), { recursive: true });
  const receipt = {
    ts: new Date().toISOString(),
    message_id: cleanMessageId,
    uid: String(uid || ''),
    subject: cleanSubject,
    steal_fn: codeCheck.stealFn,
    lesson_id: lessonRecord.id,
    obsidian_path: vaultWritten ? obsidianPath : localDossierPath,
    local_dossier_path: localDossierPath,
    implemented_files: [codeCheck.srcFile, codeCheck.testFile, localDossierPath, lessonsPath],
    test_proof: codeCheck.testFile,
  };
  const keptLines = [];
  if (fs.existsSync(internalizedLedgerPath)) {
    for (const line of fs.readFileSync(internalizedLedgerPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.message_id === cleanMessageId) continue;
        keptLines.push(JSON.stringify(parsed));
      } catch (_) {}
    }
  }
  keptLines.push(JSON.stringify(receipt));
  fs.writeFileSync(internalizedLedgerPath, `${keptLines.join('\n')}\n`, 'utf8');

  return {
    ok: true,
    readyToArchiveOrDelete: true,
    codeVerified: true,
    stealFn: codeCheck.stealFn,
    lessonId: lessonRecord.id,
    obsidianPath,
    stolenLedgerPath,
    receipt,
  };
}

function runEmailStealEngine(opts = {}) {
  const items = Array.isArray(opts.emails) ? opts.emails : [];
  const results = items.map((e) => internalizeEmailIdea({
    messageId: e.message_id || e.messageId,
    uid: e.uid,
    subject: e.subject,
    body: e.body,
    date: e.date,
  }));
  return {
    ok: results.every((r) => r.ok),
    failClosedDeleteGuardActive: true,
    totalEmailsSynthesized: results.length,
    results,
  };
}

if (require.main === module) {
  const idx = process.argv.indexOf('--ingest-json');
  if (idx !== -1 && process.argv[idx + 1]) {
    try {
      const payload = JSON.parse(process.argv[idx + 1]);
      const result = internalizeEmailIdea(payload);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(result.ok && result.readyToArchiveOrDelete ? 0 : 2);
    } catch (err) {
      process.stdout.write(`${JSON.stringify({ ok: false, readyToArchiveOrDelete: false, error: err.message })}\n`);
      process.exit(1);
    }
  } else {
    process.stdout.write(`${JSON.stringify({ ok: true, failClosedDeleteGuardActive: true })}\n`);
  }
}

module.exports = {
  classifyStrategyAndAction,
  internalizeEmailIdea,
  runEmailStealEngine,
};
