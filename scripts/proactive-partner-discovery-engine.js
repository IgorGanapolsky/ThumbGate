#!/usr/bin/env node
'use strict';

/**
 * scripts/proactive-partner-discovery-engine.js
 *
 * Proactive Global Partner & Integration Discovery Engine for ThumbGate.
 *
 * Continuously identifies companies building AI assistants, coding agents,
 * desktop copilots (e.g. MacPaw Eney), MCP tool routers, and workflow engines,
 * diagnoses their exact PreToolUse / thumbs-down-to-firewall integration point,
 * and stages tailored, plain-human integration offers in `.thumbgate/proactive-partner-offers.json`.
 *
 * Hard Governance Invariants:
 *   1. `HARD — NO SENDING AS IGOR` (`AGENTS.md:542`): Staged offers only; never auto-sends.
 *   2. `ONE-TOUCH` Deduplication (`COORDINATION.md:5`): Cross-checks `.thumbgate/inbox-triage-ledger.json`
 *      so partners already in `REPLIED_IN_SENT` are marked `ACTIVE_THREAD_LOCKED`.
 *   3. S7727 Clean: No default-argument functions passed directly to `.map()`.
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
    integrationSurface: 'On-device LFM2 / LEAP runtime powering MacPaw Eney and edge agents',
    painPoint: 'On-device small models need sub-millisecond deterministic guardrails and local preference distillation without shipping user telemetry to the cloud.',
    thumbgateSolution: 'Zero-egress <0.2ms PreToolUse firewall + local Decisive-Step DPO preference pair distiller from user 👍/👎 signals.',
    offerTier: 'Turnkey Edge Governance Reference Architecture',
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
        targets: report.offers.map((o) => ({
          id: o.id,
          company: o.company,
          domain: o.domain,
          status: o.status,
          subject: o.draft.subject,
        })),
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
