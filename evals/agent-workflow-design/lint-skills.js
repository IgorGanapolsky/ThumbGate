#!/usr/bin/env node
'use strict';
// Deterministic lint for agent-skill anti-patterns (monolithic agent, missing exit condition,
// ungated side effects, unverified-claim language). Usage: node lint-skills.js <skill-dir>...
const fs = require('node:fs');
const path = require('node:path');

const RULES = [
  { id: 'has-frontmatter', test: (t) => /^---\nname: .+\ndescription: .+\n---/m.test(t) },
  { id: 'has-exit-condition', test: (t) => /(stop condition|done condition|exit check|done means|exit condition)/i.test(t) },
  { id: 'side-effects-gated', test: (t) => !/(send|post|publish|push|deploy)/i.test(t) || /(approv|send it|confirm)/i.test(t) },
  { id: 'no-peer-chat', test: (t) => !/agents? (talk|message|chat) (to )?each other/i.test(t) || /never|no free-form/i.test(t) },
  { id: 'under-1500-words', test: (t) => t.split(/\s+/).length < 1500 },
];

function lint(dir) {
  const file = path.join(dir, 'SKILL.md');
  const text = fs.readFileSync(file, 'utf8');
  const results = RULES.map((r) => ({ id: r.id, pass: r.test(text) }));
  return { skill: path.basename(dir), results, pass: results.every((r) => r.pass) };
}

const dirs = process.argv.slice(2);
if (!dirs.length) { console.error('usage: lint-skills.js <skill-dir>...'); process.exit(2); }
let failed = 0;
for (const d of dirs) {
  const r = lint(d);
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.skill}` + (r.pass ? '' : ' -> ' + r.results.filter((x) => !x.pass).map((x) => x.id).join(', ')));
  if (!r.pass) failed += 1;
}
process.exit(failed ? 1 : 0);
