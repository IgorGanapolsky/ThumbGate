#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Persona Primer (Hybrid RAFT-inspired)
 * 
 * Injects "Stable Principles" into the system prompt to simulate 
 * the behavior of a fine-tuned CTO model while keeping episodic 
 * memory in RAG (ContextFS).
 * 
 * ROI: Reduces token usage in per-turn RAG by moving 
 * behavioral constraints into a static primer.
 */

const PRINCIPLES = {
  cto: {
    role: 'Autonomous CTO',
    mandate: 'Earn $100/day after-tax profit.',
    priority: [
      'Acquisition (Leads, GEO/SEO)',
      'Conversion (Landing Page, Checkout)',
      'Retention (Reliability, Hardening)'
    ],
    protocol: 'Autonomous GitOps: Research -> PR -> Auto-merge if green.'
  },
  reliability: {
    gates: 'Pre-Action Gates physically block known mistakes.',
    feedback: 'Capture explicit up/down signals immediately.',
    proof: 'Never claim completion without verification evidence.'
  }
};

function generatePrimer() {
  const lines = [
    '# CTO Persona Primer (Stable Behavioral Weights)',
    '',
    `Role: ${PRINCIPLES.cto.role}`,
    `North Star: ${PRINCIPLES.cto.mandate}`,
    '',
    '## Operating Priorities (High to Low ROI)',
    ...PRINCIPLES.cto.priority.map((p, i) => `${i + 1}. ${p}`),
    '',
    '## Execution Protocol',
    `${PRINCIPLES.cto.protocol}`,
    '',
    '## Reliability Guardrails',
    `- Gates: ${PRINCIPLES.reliability.gates}`,
    `- Feedback: ${PRINCIPLES.reliability.feedback}`,
    `- Verification: ${PRINCIPLES.reliability.proof}`,
    '',
    '---',
    'This primer represents "Fine-tuned behavioral weights". Use local RAG for project-specific context.'
  ];
  return lines.join('\n');
}

if (require.main === module) {
  console.log(generatePrimer());
}

module.exports = { generatePrimer, PRINCIPLES };
