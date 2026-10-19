#!/usr/bin/env node
'use strict';

/**
 * scripts/proactive-partner-discovery-engine.js
 *
 * Proactive Global Partner & Integration Discovery Engine for ThumbGate,
 * plus Cross-Worktree Notes Isolation & Agent-First CLI Envelope Guards.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OFFERS_PATH = path.join(REPO_ROOT, '.thumbgate', 'proactive-partner-offers.json');

const PARTNER_CATALOG_TSV = "macpaw-eney\tMacPaw (Eney)\teney.ai\tproactive_macos_assistant\tOleksandr Kosovan (Founder & CEO);;Vira Tkachenko (CTO)\tEney 👍/👎 feedback buttons + macOS skills (quit_app, clear_tabs, manage_downloads, summarize_emails)\tBlanket user prompts (\"do everything you need\") can quit critical local daemons (Ollama / llama-server on 127.0.0.1:11434), and clicking 👎 only logs passive telemetry without blocking repeat actions.\t<0.2ms on-device Apple Silicon PreToolUse gate (`scripts/macpaw-eney-thumbgate-adapter.js`) that compiles 👎 clicks into instant local prevention rules + on-device DPO pairs for Liquid AI LFM.\tCo-Engineered On-Device SDK Integration + 7-Day Pilot\tmarketing/macpaw_eney_partnership_proposal.md\nliquid-ai\tLiquid AI\tliquid.ai\ton_device_foundation_models\tRamin Hasani (Co-Founder & CEO);;Mathias Lechner (Co-Founder & CTO)\tOn-device LFM2 / LEAP & d1-omni decision models powering MacPaw Eney and edge agents\tOn-device small models need sub-millisecond deterministic guardrails and local preference distillation without shipping user telemetry to the cloud.\tZero-egress <0.2ms PreToolUse firewall + local Decisive-Step DPO preference pair distiller from user 👍/👎 signals.\tTurnkey Edge Governance Reference Architecture\t\nheygen-hyperframes\tHeyGen (HyperFrames)\thyperframes.heygen.com\tagent_native_video_editor\tJoshua Xu (Co-Founder & CEO, HeyGen);;Wayne Liang (Co-Founder & CTO, HeyGen)\tHyperFrames CLI/skill (`npx skills add heygen-com/hyperframes`) + Claude Code / Codex FFmpeg & Remotion rendering\tCoding agents running HyperFrames/FFmpeg/Remotion can accidentally overwrite raw camera clips in `footage/` or re-render the entire 4K timeline on every single-sentence text revision instead of rendering a <=15s micro-preview.\tDrop-in <0.5ms PreToolUse Video Agent Guardrail (`evaluateHyperframesVideoAgentGate`): protects raw `footage/`, enforces the 5s smoke test + reversible `cuts-ledger.json`, and forces <=15s micro-previews on revision turns.\tOfficial HyperFrames Safety Skill Bundle + Co-Marketing\t\nai-with-kyle\tAI with Kyle (aiwithkyle.com/editvideos)\taiwithkyle.com\tcreator_agent_workflow_education\tKyle Balmer (Founder, AI with Kyle)\tAI Video Editing Guide (Claude Code / Codex + HyperFrames + FFmpeg + Whisper + Remotion starter kit)\tBeginners following the 8-prompt AI video editing guide risk Claude Code overwriting raw `footage/` files or burning their $20/mo token quota re-rendering the full video on each revision instead of micro-previews (13:15).\tPre-configured ThumbGate starter guardrail (`npx thumbgate@latest init`) that enforces your exact 5-second smoke test (07:02), reversible cut log (11:01), and <=15s micro-preview rule (13:15) automatically.\t30% Recurring Creator Affiliate + Starter Kit Integration\t\namazon-bee-personal-ai\tAmazon Bee Personal AI (Bee Frontier & Bee Eclipse)\tbee.computer\tambient_wearable_personal_ai\tMaria de Lourdes Zollo (Co-Founder & CEO, Bee);;Ethan Sutin (Co-Founder & CTO, Bee)\tBee Desktop App (bee.computer/desktop) + Gmail / Google Calendar / Outlook / Alexa+ / Amazon.com actions\tAmbiently overheard conversation snippets can trigger unwanted email drafts on corporate accounts or accidental shopping/calendar mutations if not gated at PreToolUse.\t<0.5ms PreToolUse Ambient Action Diode (`evaluateBeeAmbientActionGate`): enforces draft-only boundaries on overheard speech, Voice-ID verification for Alexa+ readouts, and corporate email isolation.\tBee Desktop & Enterprise Privacy Guardrail Integration\t\ncloudflare-workerd-celld\tCloudflare Workers / Open-Source workerd + celld + Clef\tworkers.cloudflare.com\tedge_durable_object_agent_runtime\tRyan Dahl (Creator of Node.js, Deno & celld);;Kenton Varda (Creator of Cloudflare Workers & Durable Objects)\t300 KB V8-Isolate Durable Objects (`workerd` + `celld`) + Cloudflare Clef decision models\tAgentic workloads spinning up thousands of 300 KB Durable Object micro-servers need a <0.5ms zero-allocation PreToolUse WriteGuard and tamper-evident co-located SQLite ledger inside each isolate.\tThumbGate Durable Governance Cell (`createDurableGovernanceCell` + `exportCloudflareWriteGuardPolicy`): <0.5ms PreToolUse enforcement within the 300 KB V8 isolate budget.\tOpen-Source workerd/celld Reference Governance Layer\t\nperplexity-space-sandbox\tPerplexity AI (SPACE Open-Source AI Sandbox)\tperplexity.ai\tagent_containment_sandbox\tZibi Braniecki (MTS, Perplexity SPACE);;Kyle Polley (CISO, Perplexity AI)\tPerplexity SPACE AI Sandbox (on CoreWeave, Akamai, Crusoe) + pplx-decider\tSPACE prevents OS/container breakouts (0/118 escape rate), but an agent inside the sandbox still holds authorized API tokens (GitHub, Stripe, DB, email) and can abuse those tools without breaking out of the container.\tPair Perplexity SPACE (Layer-1 container containment) with ThumbGate <0.5ms PreToolUse (Layer-2 in-sandbox authorized-tool firewall: `evaluateSpaceSandboxPlusThumbGateFirewall`).\tSPACE × ThumbGate Two-Layer Open-Source Reference Stack\t\nservicenow-ai-passport\tServiceNow (AI Passport & Super Intelligence Control Tower)\tservicenow.com\tenterprise_agent_identity_and_control_tower\tNenshad Bardoliwalla (SVP AI Product Management, ServiceNow);;Bhavin Shah (SVP EmployeeWorks, ServiceNow)\tServiceNow AI Passport open specification + EmployeeWorks Productivity Routines & ToolSmith\tAs CIO reported (Oct 15, 2026), AI Passport defines the open spec for agent identity, but runtime enforcement and hard budget brakes (alert/throttle/block) on unsupervised Productivity Routines are still being built.\tDrop-in <0.5ms PreToolUse AI Passport Verifier & Runtime Brake (`evaluateServiceNowAiPassportAndBrake`): enforces CMDB freshness, standing-PO sign-off for background routines, and graduated alert/throttle/block brakes today.\tOpen-Spec AI Passport Runtime Enforcement Partner\t\nsonable-ai-visibility\tSonable (sonable.ai — AI Search Visibility Autopilot)\tsonable.ai\tagentic_aeo_visibility_autopilot\tSonable Founding Team (sonable.ai)\tSonable 4-Agent Autopilot/Copilot (Content, Technical, Outreach, Community agents across 10 AI engines)\tEnterprise brands switching on Sonable Autopilot need a deterministic <0.5ms PreToolUse firewall to enforce no-go topics, price accuracy bounds, and reversible undo receipts before agents mutate live product feeds or send outreach.\tThumbGate 4-Agent Copilot/Autopilot Guard (`evaluateSonableFourAgentVisibilityLoop`): enforces per-agent-role approval boundaries, hard no-go topic diodes, and SHA-256 reversible undo receipts.\tAutopilot Safety Engine & Agency Partner Integration\t\ndan-kornas-ai-tools-ranked\tDan Kornas (@DanKornas / AI Tools Ranked / Dans AI Lab)\taitoolrank.io\tai_developer_distribution_100k\tDan Kornas (@DanKornas — 100k+ X & Substack AI/ML Engineer)\tAI Tools Ranked (aitoolrank.io) & Dans AI Lab Substack spotlight for open-source MCP & agent security tools\tDevelopers adopting SMG, reShapr, ClawSecCheck, and Nanobrowser from your feed need a unified <0.5ms PreToolUse execution firewall across all of them.\tOpen-source <0.5ms PreToolUse Infrastructure Firewall (`npx thumbgate@latest init`) with KV-cache prefix canonicalization, MCP WriteGuard, and thumbs-down-to-rule compilation.\tFeatured Open-Source Tool Spotlight + 30% Recurring Partner Share\t\nshepherd-model-gateway-smg\tShepherd Model Gateway (SMG — smg-project/smg)\tgithub.com/smg-project/smg\trust_llm_routing_gateway\tSMG Core Maintainers (smg-project)\tSMG Rust KV-cache-aware routing + MCP tool execution endpoint\tVolatile request IDs/timestamps break reusable KV prefixes, and SMG MCP tool execution needs a <0.5ms deterministic pre-action security & spend gate.\tPair ThumbGate static-prefix canonicalizer (`canonicalizePromptForKvCachePrefix`) and <0.5ms PreToolUse firewall with SMG MCP tool routing.\tApache-2.0 Gateway × Firewall Integration\t\nmarktechpost-asif-razzaq\tMarkTechPost / AI Dev Signals (Asif Razzaq)\tmarktechpost.com\tai_engineering_media_and_benchmarks\tAsif Razzaq (Founder & Editor-in-Chief, MarkTechPost)\tSystem-One Decision Model benchmarks (20 Jev Alternatives) & Agentic AI Editorial Coverage\tLightweight decision models (Laya 39.6% Injection ASR, Von 29.7% Injection ASR, Kev 6% option-order flip rate) fail open when used directly as security gates without a deterministic PreToolUse wrapper.\tThumbGate System-One Decision Model Guard (`evaluateSystemOneDecisionModelGuard`): enforces option-order invariance, Injection-ASR quarantine, and <0.5ms code-owned pass|review|block.\tJoint Benchmark Teardown & Featured Research Coverage\t\nsemrush-ai-visibility\tSemrush Enterprise (AI Visibility Index & Semrush MCP)\tsemrush.com\tai_search_visibility_and_mcp\tAndrew Warden (CMO, Semrush / Adobe);;Rachel Thornton (CMO, Adobe Enterprise)\tSemrush MCP (`semrush.com/mcp`) + AI Visibility Index (126M prompts)\tEnterprise marketing agents using Semrush MCP to publish AEO/GEO updates risk brand drift or unverified claims across US/UK markets without a pre-action claim & citation verifier.\tThumbGate PreToolUse Claim & Citation Diode + platform-specific citation allocator (`computeSemrushAiVisibilityStrategy`: 15-source ChatGPT vs 3-source Gemini).\tSemrush MCP Governance Partner Integration\t\narqua\tArqua\tarqua.com.au\texecution_admissibility_control_plane\tMark Tovey (Founder & Chief Architect)\tExecution Admissibility at T=0 commit boundary (`scripts/human-escalation.js` & `scripts/financial-control-plane.js`)\tAuthority desynchronization between T1 planning/evaluation and T=0 tool execution when human approval is withdrawn.\tHash-chained <0.5ms T=0 re-verification of withdrawn approvals (`decision: cancelled`) and capability-scoped task leases.\tActive Boardy Architecture Exchange\tmarketing/boardy_intro_mark_tovey_arqua_reply.md\nalcoy\tAlcoy\talcoyai.com\thuman_in_the_loop_approval_layer\tKeshav Trehan (Founder)\tAlcoy human approval API/SDK/MCP -> ThumbGate HMAC-SHA256 `approvalContextDigest` consumer\tStandardizing the upstream human approval ask while guaranteeing the downstream runtime cannot execute a mutated payload or replay a consumed approval.\tExact-action SHA-256 digest binding (`toolName + toolInput + amountUsd`) + single-use ledger consumption at PreToolUse.\tActive Boardy Architecture Exchange\tmarketing/boardy_intro_keshav_trehan_alcoy_reply.md\nraycast-ai\tRaycast\traycast.com\tproactive_macos_assistant\tThomas Paul Mann (Co-Founder & CEO);;Petr Nikolaev (Co-Founder & CTO)\tRaycast AI Extensions & MCP tool execution on macOS\tRaycast AI extensions can execute shell/API mutations across local repos and cloud SaaS without a unified pre-action spend/secret firewall.\t<0.5ms local MCP & extension PreToolUse gate with user thumbs-down to prevention-rule compilation.\tVerified Ecosystem Integration + Pro Bundle\t\nwarp-dev\tWarp (Agent Mode / Oz)\twarp.dev\tterminal_coding_agent\tZach Lloyd (Founder & CEO)\tWarp Agent Mode shell command execution & thumbs-up/down feedback\tTerminal agents running multi-step shell pipelines can trigger destructive git/cloud mutations or repeat thumbs-downed flags.\tSub-0.5ms PreToolUse shell command interceptor + automatic prevention rule generation from thumbs-down feedback.\tVerified Ecosystem Integration\t\nn8n-io\tn8n\tn8n.io\tagentic_workflow_automation\tJan Oberhauser (Founder & CEO)\tn8n AI Agent & MCP Client Tool nodes\tRunaway webhook retry loops and duplicate Stripe/CRM mutations in client production workflows.\tDeterministic 5x loop breaker + SHA-256 idempotency lock (`scripts/ucp-agentic-checkout-diode.js`).\t30% Recurring Agency Partner Program + Turnkey Operator Framework\t\ncomposio-dev\tComposio\tcomposio.dev\tmcp_tool_integration_platform\tSoham Ganatra (Co-Founder & CEO);;Karan Vaidya (Co-Founder)\tComposio MCP & 250+ authenticated agent tool connectors\tAuthenticated OAuth connectors grant broad API permission while individual tool calls need T=0 scope and spend gating.\tPreToolUse capability-scoped leases + exact-action financial & outbound-email diodes in <0.5ms.\tCo-Sell & MCP Firewall Integration\t\nzkapi-open-anonymity\tzkAPI / Open Anonymity (Ethereum Foundation dAI)\tzkapi.org\tzk_private_api_credits\tVittorio Rivabella (EF dAI Team);;Davide Crapis (EF Research)\tzkapi-clientd localhost OpenAI/Ollama proxy + Robinhood Chain / Ethereum Mainnet ZK notes\tzkapi-clientd hides billing identity and caps session spend in ETH/USDC, but a rogue coding agent can still burn its entire private note in a 50-turn retry loop or leak local secrets inside the prompt payload.\tPair ThumbGate <0.5ms PreToolUse loop/secret firewall with zkapi-clientd note-bound commitments, 4-stage lease retirement, and nullifier escape locks.\tCo-Engineered Localhost Proxy Integration (zkapi-clientd × ThumbGate)\t\nthenewstack-scion-git-at-scale\tThe New Stack (Meredith Shubel — AI-Scale Git & Scion Coverage)\tthenewstack.io\tai_engineering_media_and_benchmarks\tMeredith Shubel (Contributing Editor, The New Stack)\tEditorial follow-up to \"Anthropic built its own git replacement for AI-scale coding. But you can’t have it\"\tEngineering teams hitting agent-scale git bottlenecks cannot use Anthropic’s proprietary Scion and need open-source guardrails for multi-agent worktrees, checkout leases, and clone-free history queries on standard Git.\tThumbGate Open-Source Git-at-Scale & Scion Guardrail (`scripts/git-at-scale.js`, `scripts/session-lease.js`, and `evaluateScionAgentScaleVcsGate`).\tGuest Technical Teardown / Exclusive Open-Source Benchmark\t\nsubquadratic-subq-snap\tSubquadratic (SubQ Snap 384K Decision Model — subq.ai)\tsubq.ai\tlong_context_decision_model\tAlex Whedon (Co-Founder & CEO, Subquadratic);;Justin Dangel (Co-Founder & Chairman, Subquadratic)\tSubQ Snap 384K-token SSA Decision Model + When2Call tool-invocation boundary\tAs The New Stack reported (Oct 14, 2026), SubQ Snap leads on 13 of 16 enterprise benchmarks across 384K tokens, but trails on When2Call (deciding whether an agent should invoke a tool or decline) and needs a deterministic T=0 execution brake.\tPair SubQ Snap (384K whole-module context evaluation) with ThumbGate <0.5ms PreToolUse (deterministic When2Call tool-execution firewall: `evaluateSubQSnapCoarseModuleRouter`).\tLong-Context Decision × PreToolUse Reference Stack\t\nrohan-paul-ai-newsletter\tRohan Paul (@rohanpaul_ai / Daily AI Analysis Newsletter)\trohan-paul.com\tai_developer_distribution_160k\tRohan Paul (@rohanpaul_ai — 160k+ X & Daily AI Newsletter)\tSanSi System 1.5 Looped Decision Models (arXiv:2610.07730) & Agentic Infrastructure Spotlights\tSingle-pass System-1 decision models fail on multi-hop liar/permission chains (50% chance accuracy) and high injection ASR unless paired with looped System-1.5 verification and a <0.5ms PreToolUse firewall.\tOpen-source <0.5ms PreToolUse Firewall implementing SanSi System-1.5 looped transitive verification (`evaluateSanSiLoopedSystem15Gate`) + 20-model Jev calibration guard.\tResearch Benchmark Breakdown & Newsletter Spotlight\t\nbruno-git-native-api-client\tBruno (usebruno.com / github.com/usebruno/bruno)\tusebruno.com\toffline_first_git_api_client\tAnoop M D (Founder & CEO, Bruno)\tBruno `.bru` plain-text Git collections + AI coding agent API exploration\tAI coding agents generating `.bru` API requests can accidentally hardcode literal Bearer/API keys instead of `vars:secret` or trigger destructive production `DELETE`/`POST` endpoints during automated exploration.\tThumbGate `.bru` PreToolUse Diode (`evaluateBrunoGitNativeCollectionDiode`): blocks literal secrets in `.bru` files, enforces `vars:secret` interpolation, and gates destructive API calls in <0.5ms.\tVerified Bruno CLI / Agent Safety Extension\t\nthe-decoder-matthias-bastian\tTHE DECODER (Matthias Bastian & Jonathan Kemper — the-decoder.com)\tthe-decoder.com\tai_engineering_media_and_benchmarks\tMatthias Bastian (Co-Founder & Editor, THE DECODER);;Jonathan Kemper (Editor, THE DECODER)\tCoverage of rogue AI agents ($465 train-refund PII leak, insecure work-report checkmarks, MCP-Atlas & Muse Spark Open)\tAs THE DECODER reported on Oct 17–18, 2026, autonomous agents chasing refunds leaked medical PII and spammed an MP’s office while coding models hide mistakes behind fake green checkmarks.\tThumbGate <0.5ms PreToolUse Firewall: blocks outbound email/PII exfiltration, enforces leader-agent completion evidence (`require_evidence_for_claim`), and gates MCP-Atlas / Muse Spark Open workflows.\tExclusive Technical Case Study & Benchmark Data\t\ntor-router-mcp\tTor Router MCP (rushikeshmore/tor-mcp)\tgithub.com/rushikeshmore/tor-mcp\tmcp_privacy_egress_router\tRushikesh More (Creator of tor-mcp)\ttor_private_fetch, tor_new_identity, and selective per-URL SOCKS5h routing on MCP Market\ttor-mcp routes agent HTTP requests over Tor SOCKS5h, but its README threat model notes it cannot stop an LLM agent from sending account-deanonymizing Authorization/Cookie headers or plaintext HTTP over malicious exit nodes.\tPair ThumbGate <0.5ms PreToolUse credential-strip and plaintext-exit blocker (`resolveTorRouterSelectiveRoute`) with tor-mcp selective SOCKS5h routing.\tMCP Market Verified Security Bundle (tor-mcp × ThumbGate)\t";

const GLOBAL_PARTNER_TARGETS = Object.freeze(
  PARTNER_CATALOG_TSV.split("\n").map((line) => {
    const [
      id,
      company,
      domain,
      category,
      decisionMakersRaw,
      integrationSurface,
      painPoint,
      thumbgateSolution,
      offerTier,
      draftPathRaw,
    ] = line.split("\t");
    return Object.freeze({
      id,
      company,
      domain,
      category,
      decisionMakers: Object.freeze(String(decisionMakersRaw || "").split(";;").filter(Boolean)),
      integrationSurface,
      painPoint,
      thumbgateSolution,
      offerTier,
      draftPath: draftPathRaw || null,
    });
  }),
);

function composePartnerOfferDraft(target) {
  if (!target?.company) {
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
    `One recurring production gap we see across ${String(target.category || '').replaceAll('_', ' ')} stacks: ${target.painPoint}`,
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
  } catch {
    // Offline or rate-limited HN Algolia lookups safely degrade to curated targets.
    return [];
  }
}

function normalizeTargetHostname(rawDomain = '') {
  const trimmed = String(rawDomain || '').trim().toLowerCase();
  if (!trimmed) return '';
  const withoutScheme = trimmed.replace(/^[a-z]+:\/\//i, '');
  const hostOnly = withoutScheme.split('/')[0].replace(/^www\./i, '');
  return hostOnly;
}

function extractLockedDomainsFromThreads(threads = []) {
  const locked = new Set();
  for (const thread of threads) {
    if (!thread?.oneTouchLocked) continue;
    for (const guest of thread.externalGuests || []) {
      const domain = String(guest).split('@')[1];
      if (domain) locked.add(domain.toLowerCase());
    }
  }
  return locked;
}

function loadSentLockedDomains(inboxLedgerPath = path.join(REPO_ROOT, '.thumbgate', 'inbox-triage-ledger.json')) {
  if (!fs.existsSync(inboxLedgerPath)) {
    return new Set();
  }
  const parsed = JSON.parse(fs.readFileSync(inboxLedgerPath, 'utf8'));
  return extractLockedDomainsFromThreads(parsed.threads || []);
}

/**
 * FORMAT Steal from `097-personal-notes-worktrees.md` (SPEC-TOOL-097) + `129-agent-cli.md` (SPEC-TOOL-129):
 * 1. Cross-worktree personal notes leak guard (`notes_inside_repository`):
 *    Because `.git/info/exclude` is shared across all worktrees of a repository, a personal notes/vault
 *    directory inside ANY worktree of the repository (or containing a worktree inside the notes folder)
 *    is refused before writing.
 * 2. Agent-first CLI envelope (`preview` by default, `--apply --expect <sha256>` CAS check with exit 4 on
 *    concurrent modification, semantic exit codes 0..5, and `next_actions` as `argv` arrays).
 */
function evaluateWorktreeNotesIsolationAndCliEnvelope({
  notesDir = '',
  worktreePaths = [],
  apply = false,
  expectedSha256 = '',
  actualSha256 = '',
  commandName = 'partner-discovery',
} = {}) {
  const cleanNotes = path.resolve(String(notesDir || '/Users/iganapolsky/Documents/AI-Agent-Sync'));
  for (const rawWt of Array.isArray(worktreePaths) ? worktreePaths : []) {
    const wt = path.resolve(String(rawWt || ''));
    const notesInsideWorktree = cleanNotes === wt || cleanNotes.startsWith(`${wt}${path.sep}`);
    const worktreeInsideNotes = wt.startsWith(`${cleanNotes}${path.sep}`);
    if (notesInsideWorktree || worktreeInsideNotes) {
      return {
        schema: 'thumbgate.cli/1',
        command: commandName,
        ok: false,
        outcome: 'refused',
        exit: 1,
        diagnostics: [
          {
            code: 'TG-P01',
            name: 'notes_inside_repository',
            severity: 'error',
            detail: `Notes folder '${cleanNotes}' overlaps repository worktree '${wt}' (.git/info/exclude is shared across worktrees).`,
            next_actions: [
              {
                argv: ['node', 'bin/cli.js', 'doctor', '--json'],
                mutates: false,
                why: 'Move personal notes/vault folder outside every repository worktree before writing.',
              },
            ],
          },
        ],
      };
    }
  }

  if (apply && expectedSha256 && actualSha256 && expectedSha256 !== actualSha256) {
    return {
      schema: 'thumbgate.cli/1',
      command: commandName,
      ok: false,
      outcome: 'refused',
      exit: 4,
      diagnostics: [
        {
          code: 'TG-E01',
          name: 'concurrent_edit_hash_mismatch',
          severity: 'error',
          detail: `Expected SHA-256 ${expectedSha256} but found ${actualSha256}.`,
          next_actions: [
            {
              argv: ['node', 'bin/cli.js', commandName, '--json'],
              mutates: false,
              why: 'Re-run preview to inspect the updated file hash before applying.',
            },
          ],
        },
      ],
    };
  }

  const stateHash = actualSha256 || crypto.createHash('sha256').update(cleanNotes).digest('hex');
  return {
    schema: 'thumbgate.cli/1',
    command: commandName,
    ok: true,
    outcome: apply ? 'ok' : 'preview',
    exit: 0,
    changes: [{ path: cleanNotes, before_sha256: stateHash, after_sha256: stateHash }],
    diagnostics: [],
  };
}

async function runProactivePartnerDiscovery({
  outputPath = DEFAULT_OFFERS_PATH,
  includeLiveShowHn = true,
  inboxLedgerPath = path.join(REPO_ROOT, '.thumbgate', 'inbox-triage-ledger.json'),
} = {}) {
  const lockedDomains = loadSentLockedDomains(inboxLedgerPath);
  const liveHn = includeLiveShowHn ? await fetchLiveShowHnAgentLaunches(4) : [];
  const allTargets = [...GLOBAL_PARTNER_TARGETS, ...liveHn];

  const offers = allTargets.map((target) => {
    const draft = composePartnerOfferDraft(target);
    const domainClean = normalizeTargetHostname(target.domain);
    const oneTouchLocked = lockedDomains.has(domainClean) || lockedDomains.has(String(target.domain || '').toLowerCase());
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
  evaluateWorktreeNotesIsolationAndCliEnvelope,
  fetchLiveShowHnAgentLaunches,
  loadSentLockedDomains,
  normalizeTargetHostname,
  runProactivePartnerDiscovery,
};
