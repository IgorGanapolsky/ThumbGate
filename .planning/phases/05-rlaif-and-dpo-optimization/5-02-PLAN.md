---
phase: 05-rlaif-and-dpo-optimization
plan: "02"
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/meta-policy.js
autonomous: true
requirements:
  - DPO-03

must_haves:
  truths:
    - "extractMetaPolicyRules() reads memory-log.jsonl, groups by category, and produces at least one rule when >= 2 entries exist for a category"
    - "Each rule has category, confidence (float [0,0.95]), trend (improving|deteriorating|needs_attention|stable), and occurrence_count fields"
    - "Output is written to meta-policy-rules.json in THUMBGATE_FEEDBACK_DIR — NOT to prevention-rules.md (different artifact)"
    - "npm run ml:meta-policy executes without error"
  artifacts:
    - path: "scripts/meta-policy.js"
      provides: "extractMetaPolicyRules() — meta-policy rule extraction from feedback trends"
      exports: ["extractMetaPolicyRules", "run"]
  key_links:
    - from: "scripts/meta-policy.js"
      to: "scripts/feedback-loop.js"
      via: "inferDomain() import — do NOT reimplement domain classification"
      pattern: "inferDomain"
    - from: "scripts/meta-policy.js"
      to: ".claude/memory/feedback/memory-log.jsonl"
      via: "reads line-by-line; filters signal==='negative'; groups by inferDomain(entry)"
      pattern: "memory-log\\.jsonl"
---

<objective>
Create the meta-policy rule extraction module that reads feedback trends and produces actionable rules with confidence scores and trend direction.

Purpose: DPO-03 requires automated extraction of meta-policy rules from accumulated feedback. This complements the simpler buildPreventionRules() (occurrence counts only) with richer confidence scoring and trend detection. Operates entirely on existing JSONL data — no new data sources needed.

Output: scripts/meta-policy.js with extractMetaPolicyRules() and run() exports.
</objective>

<execution_context>
@/Users/ganapolsky_i/.claude/get-shit-done/workflows/execute-plan.md
@/Users/ganapolsky_i/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05-rlaif-and-dpo-optimization/5-RESEARCH.md
@scripts/feedback-loop.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create meta-policy.js — rule extraction from memory-log.jsonl trends</name>
  <files>scripts/meta-policy.js</files>
  <action>
Create `scripts/meta-policy.js` with the following structure:

**Imports (reuse, do NOT reimplement):**
```javascript
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseTimestamp, timeDecayWeight } = require('./feedback-schema');
const { inferDomain } = require('./feedback-loop');
```

**`extractMetaPolicyRules(opts = {})`:**

1. Resolve `feedbackDir = opts.feedbackDir || process.env.THUMBGATE_FEEDBACK_DIR || path.join(os.homedir(), '.claude/memory/feedback')`
2. Read `memory-log.jsonl` from feedbackDir line-by-line (fs.readFileSync, split '\n', filter empty, JSON.parse)
3. Filter to only negative memories (`entry.signal === 'negative'` OR `entry.feedback === 'down'`)
4. Group by domain using `inferDomain(entry)` — result: `Map<string, entry[]>`
5. For each domain with `entries.length >= 2` (min_occurrences threshold, per RESEARCH.md Open Questions):
   - Compute `avg_weighted`: mean of `timeDecayWeight(parseTimestamp(e.timestamp))` across all entries
   - Count `recent_entries` (last 7 days): entries where `(Date.now() - parseTimestamp(e.timestamp)) < 7*24*3600*1000`
   - Count `recent_positive` from memory-log where signal=positive AND same domain (look up from full log)
   - Compute confidence: `Math.min(0.95, 0.4 + (avg_weighted * 0.3) + (entries.length * 0.05))`
   - Determine trend:
     - `"improving"` if `recent_entries === 0 && recent_positive > 0`
     - `"deteriorating"` if `recent_entries > 2 && recent_positive === 0`
     - `"needs_attention"` if `recent_entries > recent_positive`
     - `"stable"` otherwise
   - Build rule: `{ category: domain, confidence: rounded(3), trend, occurrence_count: entries.length, last_seen: ISO string of most recent entry }`
6. Sort rules by confidence descending
7. Return rules array

**`run(opts = {})`:**
- Call `extractMetaPolicyRules(opts)`
- Write result to `path.join(feedbackDir, 'meta-policy-rules.json')` via `fs.writeFileSync(..., JSON.stringify({ generated: ISO, rules }, null, 2))`
- IMPORTANT: write to `meta-policy-rules.json` NOT to `prevention-rules.md` (see RESEARCH.md Pitfall 4)
- Log count to stdout: `console.log('meta-policy: extracted N rules')`
- Return `{ rules, outputPath }`

**CLI entrypoint:**
`if (require.main === module && process.argv.includes('--extract')) { run().catch(e => { console.error(e); process.exit(1); }); }`

**`module.exports = { extractMetaPolicyRules, run };`**

Handle empty/missing memory-log.jsonl gracefully: return [] without throwing.
Handle JSON parse errors per line: skip malformed lines with a warning to stderr.

Note: `timeDecayWeight` is already exported from `feedback-schema.js` (confirmed in Phase 2). If it is not directly exported from feedback-schema.js, fall back to importing from `thompson-sampling.js` which exports it.
  </action>
  <verify>
node -e "const { extractMetaPolicyRules } = require('./scripts/meta-policy'); const rules = extractMetaPolicyRules({ feedbackDir: '/tmp/empty-test-' + Date.now() }); console.assert(Array.isArray(rules), 'must return array'); console.log('empty dir test: OK, rules:', rules.length);"
grep -n "inferDomain" scripts/meta-policy.js
grep -n "meta-policy-rules.json" scripts/meta-policy.js
  </verify>
  <done>meta-policy.js exists; extractMetaPolicyRules() returns [] for empty dir without throwing; inferDomain is imported not reimplemented; output file path is meta-policy-rules.json (not prevention-rules.md); each rule has {category, confidence, trend, occurrence_count, last_seen}</done>
</task>

</tasks>

<verification>
node -e "
const os = require('os'), fs = require('fs'), path = require('path');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-policy-test-'));
// seed 3 negative entries in same domain
const entries = [
  { signal:'negative', context:'test failed', whatWentWrong:'x', tags:['testing'], timestamp: new Date(Date.now()-86400000).toISOString() },
  { signal:'negative', context:'test broke again', whatWentWrong:'y', tags:['testing'], timestamp: new Date(Date.now()-43200000).toISOString() },
  { signal:'negative', context:'still failing tests', whatWentWrong:'z', tags:['testing'], timestamp: new Date().toISOString() },
];
fs.writeFileSync(path.join(tmpDir, 'memory-log.jsonl'), entries.map(e=>JSON.stringify(e)).join('\n'));
const { extractMetaPolicyRules } = require('./scripts/meta-policy');
const rules = extractMetaPolicyRules({ feedbackDir: tmpDir });
console.log('rules:', JSON.stringify(rules, null, 2));
console.assert(rules.length >= 1, 'expected at least 1 rule');
console.assert(rules[0].confidence >= 0 && rules[0].confidence <= 0.95, 'confidence in range');
console.assert(['improving','deteriorating','needs_attention','stable'].includes(rules[0].trend), 'valid trend');
"
</verification>

<success_criteria>
- scripts/meta-policy.js exists and exports extractMetaPolicyRules, run
- extractMetaPolicyRules() returns [] for empty directory without throwing
- With >= 2 same-domain negative entries, returns at least 1 rule with {category, confidence, trend, occurrence_count, last_seen}
- confidence is clamped to [0, 0.95]
- Output writes to meta-policy-rules.json, never to prevention-rules.md
- inferDomain imported from feedback-loop.js, not reimplemented
</success_criteria>

<output>
After completion, create `.planning/phases/05-rlaif-and-dpo-optimization/5-02-SUMMARY.md`
</output>
