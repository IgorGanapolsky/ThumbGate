#!/usr/bin/env node
'use strict';

/**
 * cli-demo.js — simulated walkthrough of the ThumbGate value prop.
 *
 * Shows in ~10 seconds:
 *   1. A mock bad action (force-push)
 *   2. Giving it a thumbs-down
 *   3. Lesson created
 *   4. Next session: gate fires, action blocked
 *
 * No actual data is written — this is a pure simulation for onboarding.
 */

const BD = '\x1b[1m';
const RST = '\x1b[0m';
const G = '\x1b[32m';
const R = '\x1b[31m';
const C = '\x1b[36m';
const Y = '\x1b[33m';
const D = '\x1b[90m';

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin — no async needed for short delays */ }
}

function runDemo(options = {}) {
  const json = options.json || false;

  if (json) {
    const steps = [
      { step: 1, event: 'bad_action', description: 'Agent runs: git push --force origin main', result: 'executed', badge: 'ALLOWED' },
      { step: 2, event: 'thumbs_down', description: 'User gives thumbs-down feedback', signal: 'down', context: 'force-pushed to main, overwrote teammate\'s work' },
      { step: 3, event: 'lesson_created', description: 'ThumbGate creates a lesson from the feedback', lesson: { id: 'demo-lesson-001', signal: 'negative', context: 'force-pushed to main', whatWentWrong: 'Overwrote teammate\'s commits on main branch', whatToChange: 'Never force-push to protected branches' } },
      { step: 4, event: 'gate_promoted', description: 'Pattern detected: 2+ failures on force-push → auto-promoted to blocking gate', gate: { id: 'auto-block-force-push', pattern: 'git push --force.*main', action: 'block', occurrences: 2 } },
      { step: 5, event: 'gate_fires', description: 'Next session: agent tries git push --force origin main', result: 'BLOCKED', reason: 'Auto-promoted gate: force-push to main detected' },
    ];
    return { demo: true, steps };
  }

  const lines = [];
  const w = (s) => lines.push(s);

  w('');
  w(`${BD}${C}thumbgate demo${RST} — see ThumbGate in action (simulated)`);
  w('═'.repeat(60));
  w('');

  // Step 1: Bad action
  w(`${BD}Session 1: Agent runs a risky command${RST}`);
  w(`${D}─────────────────────────────────────${RST}`);
  w(`  ${D}Agent>${RST} ${BD}git push --force origin main${RST}`);
  w(`  ${G}[ALLOWED]${RST} — No gates configured yet, action proceeds.`);
  w(`  ${R}💥 Result: teammate's commits overwritten on main${RST}`);
  w('');

  // Step 2: Thumbs down
  w(`${BD}You give feedback:${RST}`);
  w(`  ${R}👎 thumbs-down${RST} — "force-pushed to main, overwrote teammate's work"`);
  w('');

  // Step 3: Lesson
  w(`${BD}ThumbGate captures a lesson:${RST}`);
  w(`${D}─────────────────────────────────────${RST}`);
  w(`  ${Y}[LEARNING]${RST} Lesson created`);
  w(`  Signal      : ${R}negative${RST}`);
  w(`  Context     : force-pushed to main`);
  w(`  Root cause  : Overwrote teammate's commits on main branch`);
  w(`  Corrective  : Never force-push to protected branches`);
  w(`  Tags        : git, deployment, data-loss`);
  w('');

  // Step 4: Gate promotion
  w(`${BD}Pattern detected (2+ similar failures):${RST}`);
  w(`  ${Y}→${RST} Auto-promoted to ${R}blocking gate${RST}`);
  w(`  Gate ID     : auto-block-force-push`);
  w(`  Pattern     : git push --force.*main`);
  w(`  Action      : ${R}block${RST}`);
  w('');

  // Step 5: Next session — blocked
  w(`${BD}Session 2: Agent tries the same command${RST}`);
  w(`${D}─────────────────────────────────────${RST}`);
  w(`  ${D}Agent>${RST} ${BD}git push --force origin main${RST}`);
  w(`  ${R}[BLOCKED]${RST} Gate fired: force-push to main detected`);
  w(`  ${G}✅ Mistake prevented. Teammate's work is safe.${RST}`);
  w('');

  w('═'.repeat(60));
  w(`${BD}That's ThumbGate:${RST} one thumbs-down → permanent protection.`);
  w('');
  w(`  Get started: ${C}npx thumbgate init${RST}`);
  w(`  Capture:     ${C}npx thumbgate capture --feedback=down --context="what failed"${RST}`);
  w(`  Check gates: ${C}npx thumbgate gate-stats --json${RST}`);
  w('');

  return lines.join('\n');
}

module.exports = { runDemo };
