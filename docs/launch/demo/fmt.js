#!/usr/bin/env node
'use strict';
// Trims real ThumbGate CLI output for the demo video. It only selects and wraps real text;
// it never adds or edits words. Hidden: license and upgrade notices (not part of the loop).
const text = require('node:fs').readFileSync(0, 'utf8');
const wrap = (line, width = 74) => {
  const out = [];
  let rest = line;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(' ', width);
    if (cut < 40) cut = width;
    out.push(rest.slice(0, cut));
    rest = '    ' + rest.slice(cut).trim();
  }
  out.push(rest);
  return out;
};
const emit = (lines) => lines.flatMap((l) => wrap(l)).forEach((l) => console.log(l));
const first = text.indexOf('{');
const last = text.lastIndexOf('}');
if (first === -1) { emit(text.split('\n').filter(Boolean)); process.exit(0); }
let parsed;
try { parsed = JSON.parse(text.slice(first, last + 1)); } catch { emit(text.split('\n').filter(Boolean)); process.exit(0); }
const hook = parsed.hookSpecificOutput;
if (hook && hook.permissionDecision) {
  emit([`decision: ${hook.permissionDecision.toUpperCase()}`, hook.permissionDecisionReason]);
} else if (hook && hook.additionalContext) {
  emit(hook.additionalContext.split('\n').filter((l) => l.trim() && !/Reasoning:|PreToolUse must review|Set THUMBGATE_STRICT|flagged actions\.|Recurring failure patterns|^\s+- (Avoid|Rule)/.test(l)));
} else {
  emit(JSON.stringify(parsed, null, 2).split('\n'));
}
