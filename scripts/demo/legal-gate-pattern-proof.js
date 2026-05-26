#!/usr/bin/env node
'use strict';

// Legal-intake gate pattern proof — runs the 6 ABA-mapped gate regexes from
// config/gate-templates.json against curated intake transcripts to confirm
// each gate fires (or correctly stays silent) on Thursday's demo inputs.
//
// Run: node scripts/demo/legal-gate-pattern-proof.js
// Exit 0 = all expectations met. Non-zero = a demo-day regression.

const fs = require('fs');
const path = require('path');

const TEMPLATES = path.join(__dirname, '..', '..', 'config', 'gate-templates.json');
const data = JSON.parse(fs.readFileSync(TEMPLATES, 'utf8'));
const legalGates = data.templates.filter((t) => t.category === 'Legal Intake Safety');

if (legalGates.length !== 6) {
  console.error(`Expected 6 Legal Intake Safety gates, found ${legalGates.length}`);
  process.exit(2);
}

// Scenarios: each row is a transcript fragment + the gate that MUST fire +
// gates that MUST NOT fire (to prove the regexes are specific, not noisy).
// Transcripts reflect realistic agent tool-call payloads or response drafts.
const SCENARIOS = [
  {
    name: 'UPL: outcome prediction on FL employment claim',
    transcript: 'intake_response: Based on the facts you described, you likely prevail on a wrongful termination claim in Florida and have a strong case for retaliation damages.',
    mustFire: ['block-unauthorized-practice-of-law'],
    mustNotFire: ['require-conflict-check-before-intake', 'block-privileged-content-egress'],
  },
  {
    name: 'UPL: jurisdictional recommendation',
    transcript: 'intake_response: You should file your claim in the Southern District of Florida; that is the appropriate venue.',
    mustFire: ['block-unauthorized-practice-of-law'],
    mustNotFire: ['require-attorney-review-before-routing'],
  },
  {
    name: 'Conflict: intake_continue without clearance',
    transcript: 'intake_continue action=collect_case_facts conflict=unchecked adverse-party=GreenStar Holdings',
    mustFire: ['require-conflict-check-before-intake'],
    mustNotFire: ['block-unauthorized-practice-of-law'],
  },
  {
    name: 'Conflict: schedule_consultation with missing conflict check',
    transcript: 'schedule_consultation prospect=Smith conflict=missing adverse_party=ACME-Corp',
    mustFire: ['require-conflict-check-before-intake'],
    mustNotFire: [],
  },
  {
    name: 'Privilege egress: send_email with matter-id',
    transcript: 'send_email to=external-crm@vendor.com body="Intake summary for matter-id GT-2026-0815, privileged attorney-client notes attached."',
    mustFire: ['block-privileged-content-egress'],
    mustNotFire: ['restrict-model-endpoint-to-approved-list'],
  },
  {
    name: 'Privilege egress: crm_update with work-product',
    transcript: 'crm_update fields=[notes,status] payload="work-product memo from partner review"',
    mustFire: ['block-privileged-content-egress'],
    mustNotFire: [],
  },
  {
    name: 'Disclaimer: client_reply missing non-engagement',
    transcript: 'client_reply draft="Thanks for reaching out, we will follow up shortly." disclaimer=missing',
    mustFire: ['require-approved-disclaimer-before-response'],
    mustNotFire: ['block-unauthorized-practice-of-law'],
  },
  {
    name: 'Model governance: llm_request to consumer endpoint',
    transcript: 'llm_request endpoint=https://api.openai.com/v1/chat/completions classification=consumer',
    mustFire: ['restrict-model-endpoint-to-approved-list'],
    mustNotFire: ['block-privileged-content-egress'],
  },
  {
    name: 'Routing: assign_practice_area without review',
    transcript: 'assign_practice_area area=litigation review=missing supervisor=null',
    mustFire: ['require-attorney-review-before-routing'],
    mustNotFire: [],
  },
  {
    name: 'SAFE: neutral handoff after UPL block',
    transcript: 'intake_response: I can take your name, contact info, and preferred callback window so an attorney can follow up. disclaimer=approved',
    mustFire: [],
    mustNotFire: ['block-unauthorized-practice-of-law', 'require-conflict-check-before-intake', 'block-privileged-content-egress', 'require-approved-disclaimer-before-response'],
  },
];

const compiled = legalGates.map((g) => ({
  id: g.id,
  re: new RegExp(g.pattern),
  reCI: new RegExp(g.pattern, 'i'),
}));

let failures = 0;
let total = 0;
const failureLog = [];

for (const sc of SCENARIOS) {
  for (const gate of compiled) {
    total += 1;
    const fired = gate.re.test(sc.transcript);
    const firedCI = gate.reCI.test(sc.transcript);
    const expectFire = sc.mustFire.includes(gate.id);
    const expectNotFire = sc.mustNotFire.includes(gate.id);

    if (expectFire && !fired) {
      failures += 1;
      failureLog.push(`MISS  ${sc.name} :: ${gate.id} (case-insensitive would ${firedCI ? 'fire' : 'still miss'})`);
    } else if (expectNotFire && fired) {
      failures += 1;
      failureLog.push(`FALSE+ ${sc.name} :: ${gate.id} (fired but should not)`);
    }
  }
}

console.log(`Legal-intake gate pattern proof: ${total - failures}/${total} expectations met across ${SCENARIOS.length} scenarios.`);
if (failures === 0) {
  console.log('All 6 ABA-mapped gates fire correctly on the demo transcripts.');
  process.exit(0);
}
console.error('');
console.error('Failures:');
for (const line of failureLog) console.error('  ' + line);
process.exit(1);
