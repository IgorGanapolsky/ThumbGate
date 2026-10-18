#!/usr/bin/env node
'use strict';

/**
 * scripts/proactive-partner-discovery-engine.js
 *
 * Proactive Global Partner & Integration Discovery Engine for ThumbGate.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OFFERS_PATH = path.join(REPO_ROOT, '.thumbgate', 'proactive-partner-offers.json');

const GLOBAL_PARTNER_TARGETS = Object.freeze([
  {
    id: 'macpaw-eney',
    company: 'MacPaw (Eney)',
    domain: 'eney.ai',
    category: 'proactive_macos_assistant',
    decisionMakers: ['Oleksandr Kosovan (Founder & CEO)', 'Vira Tkachenko (CTO)'],
    integrationSurface: 'Eney 👍/👎 feedback buttons + macOS skills (quit_app, clear_tabs, manage_downloads, summarize_emails)',
    painPoint: 'Blanket user prompts ("do everything you need") can quit critical local daemons (Ollama / llama-server on 127.0.0.1:11434), and clicking 👎 only logs passive telemetry without blocking repeat actions.',
    thumbgateSolution: '<0.2ms on-device Apple Silicon PreToolUse gate (`scripts/macpaw-eney-thumbgate-adapter.js`) that compiles 👎 clicks into instant local prevention rules + on-device DPO pairs for Liquid AI LFM.',
    offerTier: 'Co-Engineered On-Device SDK Integration + 7-Day Pilot',
    draftPath: 'marketing/macpaw_eney_partnership_proposal.md',
  },
  {
    id: 'liquid-ai',
    company: 'Liquid AI',
    domain: 'liquid.ai',
    category: 'on_device_foundation_models',
    decisionMakers: ['Ramin Hasani (Co-Founder & CEO)', 'Mathias Lechner (Co-Founder & CTO)'],
    integrationSurface: 'On-device LFM2 / LEAP & d1-omni decision models powering MacPaw Eney and edge agents',
    painPoint: 'On-device small models need sub-millisecond deterministic guardrails and local preference distillation without shipping user telemetry to the cloud.',
    thumbgateSolution: 'Zero-egress <0.2ms PreToolUse firewall + local Decisive-Step DPO preference pair distiller from user 👍/👎 signals.',
    offerTier: 'Turnkey Edge Governance Reference Architecture',
    draftPath: null,
  },
  {
    id: 'heygen-hyperframes',
    company: 'HeyGen (HyperFrames)',
    domain: 'hyperframes.heygen.com',
    category: 'agent_native_video_editor',
    decisionMakers: ['Joshua Xu (Co-Founder & CEO, HeyGen)', 'Wayne Liang (Co-Founder & CTO, HeyGen)'],
    integrationSurface: 'HyperFrames CLI/skill (`npx skills add heygen-com/hyperframes`) + Claude Code / Codex FFmpeg & Remotion rendering',
    painPoint: 'Coding agents running HyperFrames/FFmpeg/Remotion can accidentally overwrite raw camera clips in `footage/` or re-render the entire 4K timeline on every single-sentence text revision instead of rendering a <=15s micro-preview.',
    thumbgateSolution: 'Drop-in <0.5ms PreToolUse Video Agent Guardrail (`evaluateHyperframesVideoAgentGate`): protects raw `footage/`, enforces the 5s smoke test + reversible `cuts-ledger.json`, and forces <=15s micro-previews on revision turns.',
    offerTier: 'Official HyperFrames Safety Skill Bundle + Co-Marketing',
    draftPath: null,
  },
  {
    id: 'ai-with-kyle',
    company: 'AI with Kyle (aiwithkyle.com/editvideos)',
    domain: 'aiwithkyle.com',
    category: 'creator_agent_workflow_education',
    decisionMakers: ['Kyle Balmer (Founder, AI with Kyle)'],
    integrationSurface: 'AI Video Editing Guide (Claude Code / Codex + HyperFrames + FFmpeg + Whisper + Remotion starter kit)',
    painPoint: 'Beginners following the 8-prompt AI video editing guide risk Claude Code overwriting raw `footage/` files or burning their $20/mo token quota re-rendering the full video on each revision instead of micro-previews (13:15).',
    thumbgateSolution: 'Pre-configured ThumbGate starter guardrail (`npx thumbgate@latest init`) that enforces your exact 5-second smoke test (07:02), reversible cut log (11:01), and <=15s micro-preview rule (13:15) automatically.',
    offerTier: '30% Recurring Creator Affiliate + Starter Kit Integration',
    draftPath: null,
  },
  {
    id: 'amazon-bee-personal-ai',
    company: 'Amazon Bee Personal AI (Bee Frontier & Bee Eclipse)',
    domain: 'bee.computer',
    category: 'ambient_wearable_personal_ai',
    decisionMakers: ['Maria de Lourdes Zollo (Co-Founder & CEO, Bee)', 'Ethan Sutin (Co-Founder & CTO, Bee)'],
    integrationSurface: 'Bee Desktop App (bee.computer/desktop) + Gmail / Google Calendar / Outlook / Alexa+ / Amazon.com actions',
    painPoint: 'Ambiently overheard conversation snippets can trigger unwanted email drafts on corporate accounts or accidental shopping/calendar mutations if not gated at PreToolUse.',
    thumbgateSolution: '<0.5ms PreToolUse Ambient Action Diode (`evaluateBeeAmbientActionGate`): enforces draft-only boundaries on overheard speech, Voice-ID verification for Alexa+ readouts, and corporate email isolation.',
    offerTier: 'Bee Desktop & Enterprise Privacy Guardrail Integration',
    draftPath: null,
  },
  {
    id: 'cloudflare-workerd-celld',
    company: 'Cloudflare Workers / Open-Source workerd + celld + Clef',
    domain: 'workers.cloudflare.com',
    category: 'edge_durable_object_agent_runtime',
    decisionMakers: ['Ryan Dahl (Creator of Node.js, Deno & celld)', 'Kenton Varda (Creator of Cloudflare Workers & Durable Objects)'],
    integrationSurface: '300 KB V8-Isolate Durable Objects (`workerd` + `celld`) + Cloudflare Clef decision models',
    painPoint: 'Agentic workloads spinning up thousands of 300 KB Durable Object micro-servers need a <0.5ms zero-allocation PreToolUse WriteGuard and tamper-evident co-located SQLite ledger inside each isolate.',
    thumbgateSolution: 'ThumbGate Durable Governance Cell (`createDurableGovernanceCell` + `exportCloudflareWriteGuardPolicy`): <0.5ms PreToolUse enforcement within the 300 KB V8 isolate budget.',
    offerTier: 'Open-Source workerd/celld Reference Governance Layer',
    draftPath: null,
  },
  {
    id: 'perplexity-space-sandbox',
    company: 'Perplexity AI (SPACE Open-Source AI Sandbox)',
    domain: 'perplexity.ai',
    category: 'agent_containment_sandbox',
    decisionMakers: ['Zibi Braniecki (MTS, Perplexity SPACE)', 'Kyle Polley (CISO, Perplexity AI)'],
    integrationSurface: 'Perplexity SPACE AI Sandbox (on CoreWeave, Akamai, Crusoe) + pplx-decider',
    painPoint: 'SPACE prevents OS/container breakouts (0/118 escape rate), but an agent inside the sandbox still holds authorized API tokens (GitHub, Stripe, DB, email) and can abuse those tools without breaking out of the container.',
    thumbgateSolution: 'Pair Perplexity SPACE (Layer-1 container containment) with ThumbGate <0.5ms PreToolUse (Layer-2 in-sandbox authorized-tool firewall: `evaluateSpaceSandboxPlusThumbGateFirewall`).',
    offerTier: 'SPACE × ThumbGate Two-Layer Open-Source Reference Stack',
    draftPath: null,
  },
  {
    id: 'servicenow-ai-passport',
    company: 'ServiceNow (AI Passport & Super Intelligence Control Tower)',
    domain: 'servicenow.com',
    category: 'enterprise_agent_identity_and_control_tower',
    decisionMakers: ['Nenshad Bardoliwalla (SVP AI Product Management, ServiceNow)', 'Bhavin Shah (SVP EmployeeWorks, ServiceNow)'],
    integrationSurface: 'ServiceNow AI Passport open specification + EmployeeWorks Productivity Routines & ToolSmith',
    painPoint: 'As CIO reported (Oct 15, 2026), AI Passport defines the open spec for agent identity, but runtime enforcement and hard budget brakes (alert/throttle/block) on unsupervised Productivity Routines are still being built.',
    thumbgateSolution: 'Drop-in <0.5ms PreToolUse AI Passport Verifier & Runtime Brake (`evaluateServiceNowAiPassportAndBrake`): enforces CMDB freshness, standing-PO sign-off for background routines, and graduated alert/throttle/block brakes today.',
    offerTier: 'Open-Spec AI Passport Runtime Enforcement Partner',
    draftPath: null,
  },
  {
    id: 'sonable-ai-visibility',
    company: 'Sonable (sonable.ai — AI Search Visibility Autopilot)',
    domain: 'sonable.ai',
    category: 'agentic_aeo_visibility_autopilot',
    decisionMakers: ['Sonable Founding Team (sonable.ai)'],
    integrationSurface: 'Sonable 4-Agent Autopilot/Copilot (Content, Technical, Outreach, Community agents across 10 AI engines)',
    painPoint: 'Enterprise brands switching on Sonable Autopilot need a deterministic <0.5ms PreToolUse firewall to enforce no-go topics, price accuracy bounds, and reversible undo receipts before agents mutate live product feeds or send outreach.',
    thumbgateSolution: 'ThumbGate 4-Agent Copilot/Autopilot Guard (`evaluateSonableFourAgentVisibilityLoop`): enforces per-agent-role approval boundaries, hard no-go topic diodes, and SHA-256 reversible undo receipts.',
    offerTier: 'Autopilot Safety Engine & Agency Partner Integration',
    draftPath: null,
  },
  {
    id: 'dan-kornas-ai-tools-ranked',
    company: 'Dan Kornas (@DanKornas / AI Tools Ranked / Dans AI Lab)',
    domain: 'aitoolrank.io',
    category: 'ai_developer_distribution_100k',
    decisionMakers: ['Dan Kornas (@DanKornas — 100k+ X & Substack AI/ML Engineer)'],
    integrationSurface: 'AI Tools Ranked (aitoolrank.io) & Dans AI Lab Substack spotlight for open-source MCP & agent security tools',
    painPoint: 'Developers adopting SMG, reShapr, ClawSecCheck, and Nanobrowser from your feed need a unified <0.5ms PreToolUse execution firewall across all of them.',
    thumbgateSolution: 'Open-source <0.5ms PreToolUse Infrastructure Firewall (`npx thumbgate@latest init`) with KV-cache prefix canonicalization, MCP WriteGuard, and thumbs-down-to-rule compilation.',
    offerTier: 'Featured Open-Source Tool Spotlight + 30% Recurring Partner Share',
    draftPath: null,
  },
  {
    id: 'shepherd-model-gateway-smg',
    company: 'Shepherd Model Gateway (SMG — smg-project/smg)',
    domain: 'github.com/smg-project/smg',
    category: 'rust_llm_routing_gateway',
    decisionMakers: ['SMG Core Maintainers (smg-project)'],
    integrationSurface: 'SMG Rust KV-cache-aware routing + MCP tool execution endpoint',
    painPoint: 'Volatile request IDs/timestamps break reusable KV prefixes, and SMG MCP tool execution needs a <0.5ms deterministic pre-action security & spend gate.',
    thumbgateSolution: 'Pair ThumbGate static-prefix canonicalizer (`canonicalizePromptForKvCachePrefix`) and <0.5ms PreToolUse firewall with SMG MCP tool routing.',
    offerTier: 'Apache-2.0 Gateway × Firewall Integration',
    draftPath: null,
  },
  {
    id: 'marktechpost-asif-razzaq',
    company: 'MarkTechPost / AI Dev Signals (Asif Razzaq)',
    domain: 'marktechpost.com',
    category: 'ai_engineering_media_and_benchmarks',
    decisionMakers: ['Asif Razzaq (Founder & Editor-in-Chief, MarkTechPost)'],
    integrationSurface: 'System-One Decision Model benchmarks (20 Jev Alternatives) & Agentic AI Editorial Coverage',
    painPoint: 'Lightweight decision models (Laya 39.6% Injection ASR, Von 29.7% Injection ASR, Kev 6% option-order flip rate) fail open when used directly as security gates without a deterministic PreToolUse wrapper.',
    thumbgateSolution: 'ThumbGate System-One Decision Model Guard (`evaluateSystemOneDecisionModelGuard`): enforces option-order invariance, Injection-ASR quarantine, and <0.5ms code-owned pass|review|block.',
    offerTier: 'Joint Benchmark Teardown & Featured Research Coverage',
    draftPath: null,
  },
  {
    id: 'semrush-ai-visibility',
    company: 'Semrush Enterprise (AI Visibility Index & Semrush MCP)',
    domain: 'semrush.com',
    category: 'ai_search_visibility_and_mcp',
    decisionMakers: ['Andrew Warden (CMO, Semrush / Adobe)', 'Rachel Thornton (CMO, Adobe Enterprise)'],
    integrationSurface: 'Semrush MCP (`semrush.com/mcp`) + AI Visibility Index (126M prompts)',
    painPoint: 'Enterprise marketing agents using Semrush MCP to publish AEO/GEO updates risk brand drift or unverified claims across US/UK markets without a pre-action claim & citation verifier.',
    thumbgateSolution: 'ThumbGate PreToolUse Claim & Citation Diode + platform-specific citation allocator (`computeSemrushAiVisibilityStrategy`: 15-source ChatGPT vs 3-source Gemini).',
    offerTier: 'Semrush MCP Governance Partner Integration',
    draftPath: null,
  },
  {
    id: 'arqua',
    company: 'Arqua',
    domain: 'arqua.com.au',
    category: 'execution_admissibility_control_plane',
    decisionMakers: ['Mark Tovey (Founder & Chief Architect)'],
    integrationSurface: 'Execution Admissibility at T=0 commit boundary (`scripts/human-escalation.js` & `scripts/financial-control-plane.js`)',
    painPoint: 'Authority desynchronization between T1 planning/evaluation and T=0 tool execution when human approval is withdrawn.',
    thumbgateSolution: 'Hash-chained <0.5ms T=0 re-verification of withdrawn approvals (`decision: cancelled`) and capability-scoped task leases.',
    offerTier: 'Active Boardy Architecture Exchange',
    draftPath: 'marketing/boardy_intro_mark_tovey_arqua_reply.md',
  },
  {
    id: 'alcoy',
    company: 'Alcoy',
    domain: 'alcoyai.com',
    category: 'human_in_the_loop_approval_layer',
    decisionMakers: ['Keshav Trehan (Founder)'],
    integrationSurface: 'Alcoy human approval API/SDK/MCP -> ThumbGate HMAC-SHA256 `approvalContextDigest` consumer',
    painPoint: 'Standardizing the upstream human approval ask while guaranteeing the downstream runtime cannot execute a mutated payload or replay a consumed approval.',
    thumbgateSolution: 'Exact-action SHA-256 digest binding (`toolName + toolInput + amountUsd`) + single-use ledger consumption at PreToolUse.',
    offerTier: 'Active Boardy Architecture Exchange',
    draftPath: 'marketing/boardy_intro_keshav_trehan_alcoy_reply.md',
  },
  {
    id: 'raycast-ai',
    company: 'Raycast',
    domain: 'raycast.com',
    category: 'proactive_macos_assistant',
    decisionMakers: ['Thomas Paul Mann (Co-Founder & CEO)', 'Petr Nikolaev (Co-Founder & CTO)'],
    integrationSurface: 'Raycast AI Extensions & MCP tool execution on macOS',
    painPoint: 'Raycast AI extensions can execute shell/API mutations across local repos and cloud SaaS without a unified pre-action spend/secret firewall.',
    thumbgateSolution: '<0.5ms local MCP & extension PreToolUse gate with user thumbs-down to prevention-rule compilation.',
    offerTier: 'Verified Ecosystem Integration + Pro Bundle',
    draftPath: null,
  },
  {
    id: 'warp-dev',
    company: 'Warp (Agent Mode / Oz)',
    domain: 'warp.dev',
    category: 'terminal_coding_agent',
    decisionMakers: ['Zach Lloyd (Founder & CEO)'],
    integrationSurface: 'Warp Agent Mode shell command execution & thumbs-up/down feedback',
    painPoint: 'Terminal agents running multi-step shell pipelines can trigger destructive git/cloud mutations or repeat thumbs-downed flags.',
    thumbgateSolution: 'Sub-0.5ms PreToolUse shell command interceptor + automatic prevention rule generation from thumbs-down feedback.',
    offerTier: 'Verified Ecosystem Integration',
    draftPath: null,
  },
  {
    id: 'n8n-io',
    company: 'n8n',
    domain: 'n8n.io',
    category: 'agentic_workflow_automation',
    decisionMakers: ['Jan Oberhauser (Founder & CEO)'],
    integrationSurface: 'n8n AI Agent & MCP Client Tool nodes',
    painPoint: 'Runaway webhook retry loops and duplicate Stripe/CRM mutations in client production workflows.',
    thumbgateSolution: 'Deterministic 5x loop breaker + SHA-256 idempotency lock (`scripts/ucp-agentic-checkout-diode.js`).',
    offerTier: '30% Recurring Agency Partner Program + Turnkey Operator Framework',
    draftPath: null,
  },
  {
    id: 'composio-dev',
    company: 'Composio',
    domain: 'composio.dev',
    category: 'mcp_tool_integration_platform',
    decisionMakers: ['Soham Ganatra (Co-Founder & CEO)', 'Karan Vaidya (Co-Founder)'],
    integrationSurface: 'Composio MCP & 250+ authenticated agent tool connectors',
    painPoint: 'Authenticated OAuth connectors grant broad API permission while individual tool calls need T=0 scope and spend gating.',
    thumbgateSolution: 'PreToolUse capability-scoped leases + exact-action financial & outbound-email diodes in <0.5ms.',
    offerTier: 'Co-Sell & MCP Firewall Integration',
    draftPath: null,
  },
  {
    id: 'zkapi-open-anonymity',
    company: 'zkAPI / Open Anonymity (Ethereum Foundation dAI)',
    domain: 'zkapi.org',
    category: 'zk_private_api_credits',
    decisionMakers: ['Vittorio Rivabella (EF dAI Team)', 'Davide Crapis (EF Research)'],
    integrationSurface: 'zkapi-clientd localhost OpenAI/Ollama proxy + Robinhood Chain / Ethereum Mainnet ZK notes',
    painPoint: 'zkapi-clientd hides billing identity and caps session spend in ETH/USDC, but a rogue coding agent can still burn its entire private note in a 50-turn retry loop or leak local secrets inside the prompt payload.',
    thumbgateSolution: 'Pair ThumbGate <0.5ms PreToolUse loop/secret firewall with zkapi-clientd note-bound commitments, 4-stage lease retirement, and nullifier escape locks.',
    offerTier: 'Co-Engineered Localhost Proxy Integration (zkapi-clientd × ThumbGate)',
    draftPath: null,
  },
  {
    id: 'thenewstack-scion-git-at-scale',
    company: 'The New Stack (Meredith Shubel — AI-Scale Git & Scion Coverage)',
    domain: 'thenewstack.io',
    category: 'ai_engineering_media_and_benchmarks',
    decisionMakers: ['Meredith Shubel (Contributing Editor, The New Stack)'],
    integrationSurface: 'Editorial follow-up to "Anthropic built its own git replacement for AI-scale coding. But you can’t have it"',
    painPoint: 'Engineering teams hitting agent-scale git bottlenecks cannot use Anthropic’s proprietary Scion and need open-source guardrails for multi-agent worktrees, checkout leases, and clone-free history queries on standard Git.',
    thumbgateSolution: 'ThumbGate Open-Source Git-at-Scale & Scion Guardrail (`scripts/git-at-scale.js`, `scripts/session-lease.js`, and `evaluateScionAgentScaleVcsGate`).',
    offerTier: 'Guest Technical Teardown / Exclusive Open-Source Benchmark',
    draftPath: null,
  },
  {
    id: 'subquadratic-subq-snap',
    company: 'Subquadratic (SubQ Snap 384K Decision Model — subq.ai)',
    domain: 'subq.ai',
    category: 'long_context_decision_model',
    decisionMakers: ['Alex Whedon (Co-Founder & CEO, Subquadratic)', 'Justin Dangel (Co-Founder & Chairman, Subquadratic)'],
    integrationSurface: 'SubQ Snap 384K-token SSA Decision Model + When2Call tool-invocation boundary',
    painPoint: 'As The New Stack reported (Oct 14, 2026), SubQ Snap leads on 13 of 16 enterprise benchmarks across 384K tokens, but trails on When2Call (deciding whether an agent should invoke a tool or decline) and needs a deterministic T=0 execution brake.',
    thumbgateSolution: 'Pair SubQ Snap (384K whole-module context evaluation) with ThumbGate <0.5ms PreToolUse (deterministic When2Call tool-execution firewall: `evaluateSubQSnapCoarseModuleRouter`).',
    offerTier: 'Long-Context Decision × PreToolUse Reference Stack',
    draftPath: null,
  },
  {
    id: 'rohan-paul-ai-newsletter',
    company: 'Rohan Paul (@rohanpaul_ai / Daily AI Analysis Newsletter)',
    domain: 'rohan-paul.com',
    category: 'ai_developer_distribution_160k',
    decisionMakers: ['Rohan Paul (@rohanpaul_ai — 160k+ X & Daily AI Newsletter)'],
    integrationSurface: 'SanSi System 1.5 Looped Decision Models (arXiv:2610.07730) & Agentic Infrastructure Spotlights',
    painPoint: 'Single-pass System-1 decision models fail on multi-hop liar/permission chains (50% chance accuracy) and high injection ASR unless paired with looped System-1.5 verification and a <0.5ms PreToolUse firewall.',
    thumbgateSolution: 'Open-source <0.5ms PreToolUse Firewall implementing SanSi System-1.5 looped transitive verification (`evaluateSanSiLoopedSystem15Gate`) + 20-model Jev calibration guard.',
    offerTier: 'Research Benchmark Breakdown & Newsletter Spotlight',
    draftPath: null,
  },
  {
    id: 'bruno-git-native-api-client',
    company: 'Bruno (usebruno.com / github.com/usebruno/bruno)',
    domain: 'usebruno.com',
    category: 'offline_first_git_api_client',
    decisionMakers: ['Anoop M D (Founder & CEO, Bruno)'],
    integrationSurface: 'Bruno `.bru` plain-text Git collections + AI coding agent API exploration',
    painPoint: 'AI coding agents generating `.bru` API requests can accidentally hardcode literal Bearer/API keys instead of `vars:secret` or trigger destructive production `DELETE`/`POST` endpoints during automated exploration.',
    thumbgateSolution: 'ThumbGate `.bru` PreToolUse Diode (`evaluateBrunoGitNativeCollectionDiode`): blocks literal secrets in `.bru` files, enforces `vars:secret` interpolation, and gates destructive API calls in <0.5ms.',
    offerTier: 'Verified Bruno CLI / Agent Safety Extension',
    draftPath: null,
  },
  {
    id: 'the-decoder-matthias-bastian',
    company: 'THE DECODER (Matthias Bastian & Jonathan Kemper — the-decoder.com)',
    domain: 'the-decoder.com',
    category: 'ai_engineering_media_and_benchmarks',
    decisionMakers: ['Matthias Bastian (Co-Founder & Editor, THE DECODER)', 'Jonathan Kemper (Editor, THE DECODER)'],
    integrationSurface: 'Coverage of rogue AI agents ($465 train-refund PII leak, insecure work-report checkmarks, MCP-Atlas & Muse Spark Open)',
    painPoint: 'As THE DECODER reported on Oct 17–18, 2026, autonomous agents chasing refunds leaked medical PII and spammed an MP’s office while coding models hide mistakes behind fake green checkmarks.',
    thumbgateSolution: 'ThumbGate <0.5ms PreToolUse Firewall: blocks outbound email/PII exfiltration, enforces leader-agent completion evidence (`require_evidence_for_claim`), and gates MCP-Atlas / Muse Spark Open workflows.',
    offerTier: 'Exclusive Technical Case Study & Benchmark Data',
    draftPath: null,
  },
  {
    id: 'tor-router-mcp',
    company: 'Tor Router MCP (rushikeshmore/tor-mcp)',
    domain: 'github.com/rushikeshmore/tor-mcp',
    category: 'mcp_privacy_egress_router',
    decisionMakers: ['Rushikesh More (Creator of tor-mcp)'],
    integrationSurface: 'tor_private_fetch, tor_new_identity, and selective per-URL SOCKS5h routing on MCP Market',
    painPoint: 'tor-mcp routes agent HTTP requests over Tor SOCKS5h, but its README threat model notes it cannot stop an LLM agent from sending account-deanonymizing Authorization/Cookie headers or plaintext HTTP over malicious exit nodes.',
    thumbgateSolution: 'Pair ThumbGate <0.5ms PreToolUse credential-strip and plaintext-exit blocker (`resolveTorRouterSelectiveRoute`) with tor-mcp selective SOCKS5h routing.',
    offerTier: 'MCP Market Verified Security Bundle (tor-mcp × ThumbGate)',
    draftPath: null,
  },
]);

function composePartnerOfferDraft(target) {
  if (!target || !target.company) {
    throw new Error('target.company is required');
  }
  const decisionMaker = Array.isArray(target.decisionMakers) && target.decisionMakers.length > 0
    ? target.decisionMakers[0].split('(')[0].trim()
    : `${target.company} Team`;

  const subject = `${target.company} × ThumbGate: <0.5ms PreToolUse firewall for ${target.integrationSurface}`;
  const body = [
    `Hi ${decisionMaker},`,
    '',
    `We've been following ${target.company} closely — specifically around ${target.integrationSurface}.`,
    '',
    `One recurring production gap we see across ${target.category.replace(/_/g, ' ')} stacks: ${target.painPoint}`,
    '',
    `At ThumbGate (https://thumbgate.ai), we built the sub-0.5ms local PreToolUse firewall and thumbs-down-to-rule engine that sits right on that boundary: ${target.thumbgateSolution}`,
    '',
    'Everything is open-source and runnable in <2 minutes (`npx thumbgate@latest init` — https://github.com/IgorGanapolsky/ThumbGate).',
    '',
    `Would you be open to a quick async walkthrough of how a ${target.company} × ThumbGate adapter looks in practice?`,
    '',
    'Best,',
    'Igor Ganapolsky',
    'Founder & CTO, ThumbGate',
    'https://thumbgate.ai',
  ].join('\n');

  return {
    targetId: target.id,
    company: target.company,
    domain: target.domain,
    recipientLabel: decisionMaker,
    subject,
    body,
    hardNoSendEnforced: true,
  };
}

async function fetchLiveShowHnAgentLaunches(limit = 5) {
  try {
    const res = await fetch(
      `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent('"Show HN" AI agent OR MCP OR copilot')}&tags=show_hn&hitsPerPage=${Number(limit) || 5}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.hits || []).map((hit) => ({
      id: `show-hn-${hit.objectID}`,
      company: (hit.title || '').replace(/^Show HN:\s*/i, '').split(/[–—-]/)[0].trim() || `Show HN #${hit.objectID}`,
      domain: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      category: 'live_show_hn_agent_launch',
      decisionMakers: [`${hit.author || 'founder'} (HN Creator)`],
      integrationSurface: hit.title || 'AI Agent / MCP execution boundary',
      painPoint: 'Newly launched agent tools execute shell/API actions without a <0.5ms pre-action loop/spend firewall or thumbs-down-to-rule compiler.',
      thumbgateSolution: 'Drop-in <0.5ms PreToolUse firewall (`npx thumbgate@latest init`) + tamper-evident SHA-256 execution receipts.',
      offerTier: 'Launch Partner Integration & 48-Hr Hardening Sprint ($499)',
      hnUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    }));
  } catch (_) {
    return [];
  }
}

function loadSentLockedDomains(inboxLedgerPath = path.join(REPO_ROOT, '.thumbgate', 'inbox-triage-ledger.json')) {
  const locked = new Set();
  try {
    if (fs.existsSync(inboxLedgerPath)) {
      const parsed = JSON.parse(fs.readFileSync(inboxLedgerPath, 'utf8'));
      for (const t of parsed.threads || []) {
        if (t.oneTouchLocked) {
          for (const g of t.externalGuests || []) {
            const domain = String(g).split('@')[1];
            if (domain) locked.add(domain.toLowerCase());
          }
        }
      }
    }
  } catch (_) {}
  return locked;
}

async function runProactivePartnerDiscovery({
  outputPath = DEFAULT_OFFERS_PATH,
  includeLiveShowHn = true,
} = {}) {
  const lockedDomains = loadSentLockedDomains();
  const liveHn = includeLiveShowHn ? await fetchLiveShowHnAgentLaunches(4) : [];
  const allTargets = [...GLOBAL_PARTNER_TARGETS, ...liveHn];

  const offers = allTargets.map((target) => {
    const draft = composePartnerOfferDraft(target);
    const domainClean = String(target.domain || '').toLowerCase();
    const oneTouchLocked = lockedDomains.has(domainClean);
    return {
      ...target,
      status: oneTouchLocked ? 'ACTIVE_THREAD_ONE_TOUCH_LOCKED' : 'OFFER_STAGED_AWAITING_IGOR_YES',
      oneTouchLocked,
      draft,
    };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    hardNoSendEnforced: true,
    totalTargets: offers.length,
    curatedCount: GLOBAL_PARTNER_TARGETS.length,
    liveDiscoveredShowHnCount: liveHn.length,
    offers,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

if (require.main === module) {
  runProactivePartnerDiscovery()
    .then((report) => {
      console.log(JSON.stringify({
        ok: true,
        generatedAt: report.generatedAt,
        totalTargets: report.totalTargets,
        curatedCount: report.curatedCount,
        liveDiscoveredShowHnCount: report.liveDiscoveredShowHnCount,
        outputPath: DEFAULT_OFFERS_PATH,
      }, null, 2));
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}

module.exports = {
  GLOBAL_PARTNER_TARGETS,
  composePartnerOfferDraft,
  fetchLiveShowHnAgentLaunches,
  runProactivePartnerDiscovery,
};
