/**
 * Autonomous GTM Play & Lead Generation Engine for ThumbGate & Dayglass.
 * 
 * Inspired by Pancake.ai ("Infrastructure powering your GTM factory"):
 * - Brain: ICP definition, brand voice, CRM accounts, competitor landscape.
 * - Signals: Ingests buying triggers (funding, hiring, AI test failures, site visits).
 * - Plays: Runs targeted outreach campaigns with human-in-the-loop approval.
 * - Continuous Learning: Every lead approval/rejection refines ICP scoring weights.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_GTM_DATA_PATH = path.join(os.homedir(), '.thumbgate', 'gtm-brain.json');

const DEFAULT_BRAIN = {
  icp: {
    targetTitles: ['VP of Engineering', 'CTO', 'Head of AI', 'Staff AI Platform Engineer', 'Solo AI SaaS Founder'],
    companyStages: ['Seed', 'Series A', 'Series B', 'High-Growth Tech SMB'],
    painPoints: [
      'Autonomous coding agents hallucinating breaking changes',
      'Tautological unit tests passing green while code is broken',
      'ORM scatter queries taking down sharded databases',
      'High token spend on long verify-and-repair agent loops',
      'Cloud meeting recorders leaking internal IP',
    ],
  },
  voice: {
    tone: 'concise, direct, highly technical, anti-slop, grounded in concrete code evidence',
    prohibitedPhrases: ['dive deep', 'game changer', 'unleash', 'revolutionary', 'in today\'s fast-paced world'],
    preferredPhrases: ['fail-closed guardrail', 'deterministic check', 'mutation testing', 'token efficiency', 'on-device privacy'],
  },
  products: {
    thumbgate_pro: {
      name: 'ThumbGate Pro',
      price: '$19/mo or $149/yr',
      url: 'https://thumbgate.ai/go/pro-direct',
      bestFor: 'Individual engineers and fast teams building autonomous agents',
    },
    rule_pack_kit: {
      name: 'ThumbGate Production Rule-Pack Kit',
      price: '$49 one-time',
      url: 'https://thumbgate.ai/go/bundle-49',
      bestFor: 'Engineers who want battle-tested production rules for Claude Code and Cursor',
    },
    workflow_diagnostic: {
      name: 'ThumbGate Enterprise Workflow Gate Diagnostic',
      price: '$499',
      url: 'https://thumbgate.ai/diagnostic',
      bestFor: 'Enterprises experiencing recurring agentic regressions in production',
    },
    dayglass_pro: {
      name: 'Dayglass Local Meeting & Screen Memory',
      price: '$20/mo',
      url: 'https://dayglass.ai',
      bestFor: 'Founders and consultants needing private, local, Apple Silicon meeting recall',
    },
  },
  weights: {
    hiringSignal: 1.5,
    fundingSignal: 1.2,
    failureSignal: 2.0,
  },
};

class GtmPlayEngine {
  constructor(options = {}) {
    this.storagePath = options.storagePath || DEFAULT_GTM_DATA_PATH;
    this.brain = this.loadBrain();
    this.plays = [];
    this.leads = [];
  }

  loadBrain() {
    try {
      if (fs.existsSync(this.storagePath)) {
        return JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      }
    } catch (_) {}
    return JSON.parse(JSON.stringify(DEFAULT_BRAIN));
  }

  saveBrain() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storagePath, JSON.stringify(this.brain, null, 2), 'utf8');
    } catch (_) {}
  }

  scoreLead(lead) {
    let score = 0.5;
    const { title = '', companyStage = '', trigger = '' } = lead;

    // Check title match
    if (this.brain.icp.targetTitles.some((t) => title.toLowerCase().includes(t.toLowerCase()))) {
      score += 0.25;
    }

    // Check stage match
    if (this.brain.icp.companyStages.some((s) => companyStage.toLowerCase().includes(s.toLowerCase()))) {
      score += 0.15;
    }

    // Check trigger signals
    const triggerLower = trigger.toLowerCase();
    if (triggerLower.includes('broke production') || triggerLower.includes('ai hallucination') || triggerLower.includes('agent failure')) {
      score += 0.3 * (this.brain.weights.failureSignal || 1.0);
    } else if (triggerLower.includes('hiring') || triggerLower.includes('growing engineering')) {
      score += 0.2 * (this.brain.weights.hiringSignal || 1.0);
    } else if (triggerLower.includes('raised') || triggerLower.includes('seed') || triggerLower.includes('series')) {
      score += 0.15 * (this.brain.weights.fundingSignal || 1.0);
    }

    return Math.min(1.0, Math.round(score * 100) / 100);
  }

  createPlay(playSpec) {
    const play = {
      id: `play_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: playSpec.name,
      targetFilter: playSpec.targetFilter || {},
      status: 'ACTIVE',
      template: playSpec.template || 'Hi {{name}}, noticed {{trigger}}. We built {{product}} to solve {{pain_point}} deterministically.',
      createdAt: new Date().toISOString(),
    };
    this.plays.push(play);
    return play;
  }

  generateOutreachDraft(lead, play) {
    const icpFit = this.scoreLead(lead);
    const recommendedProduct = icpFit >= 0.85
      ? this.brain.products.workflow_diagnostic
      : this.brain.products.thumbgate_pro;

    let body = `Hi ${lead.name || 'there'},\n\n`;
    body += `Noticed ${lead.trigger || 'your recent work with autonomous coding agents'}.\n\n`;
    body += `Most teams hit a wall when AI agents generate tautological tests or introduce un-indexed scatter queries. We built ${recommendedProduct.name} (${recommendedProduct.price}) to catch these deterministically with fail-closed pre-action guardrails.\n\n`;
    body += `Check it out here: ${recommendedProduct.url}\n\n`;
    body += `Best,\nIgor`;

    const draft = {
      leadId: lead.id || `lead_${Date.now()}`,
      leadName: lead.name,
      leadEmail: lead.email,
      icpFit,
      product: recommendedProduct.name,
      subject: `Deterministic guardrails for ${lead.company || 'your agent fleet'}`,
      body,
      status: 'STAGED_FOR_APPROVAL', // Follows our strict Stage 1 / Stage 2 protocol!
      requiresApproval: true,
      stagedAt: new Date().toISOString(),
    };

    this.leads.push(draft);
    return draft;
  }

  approveLeadOutreach(leadId) {
    const lead = this.leads.find((l) => l.leadId === leadId);
    if (!lead) throw new Error(`Lead not found: ${leadId}`);

    lead.status = 'APPROVED';
    lead.approvedAt = new Date().toISOString();

    // Reward loop: strengthen signal weights
    this.brain.weights.failureSignal = (this.brain.weights.failureSignal || 1.0) * 1.05;
    this.saveBrain();

    return {
      ok: true,
      leadId,
      status: 'APPROVED',
      action: 'READY_TO_DISPATCH',
    };
  }

  rejectLeadOutreach(leadId, reason = '') {
    const lead = this.leads.find((l) => l.leadId === leadId);
    if (!lead) throw new Error(`Lead not found: ${leadId}`);

    lead.status = 'REJECTED';
    lead.rejectionReason = reason;

    // Penalty loop: attenuate signal weights
    this.brain.weights.failureSignal = Math.max(0.5, (this.brain.weights.failureSignal || 1.0) * 0.95);
    this.saveBrain();

    return {
      ok: true,
      leadId,
      status: 'REJECTED',
    };
  }
}

module.exports = {
  GtmPlayEngine,
  DEFAULT_BRAIN,
};
