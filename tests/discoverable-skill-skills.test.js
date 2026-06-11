#!/usr/bin/env node
'use strict';

// discoverable-skill-skills.test.js — guards the auto-triggering /thumbgate-* SKILLS.
//
// Companion to discoverable-skills.test.js (which guards the /thumbgate-* slash COMMANDS).
// These SKILL.md skills are the description-discovered surface: a user types `/thumbgate-guard`
// OR says "never do that again" and the skill auto-triggers. They WRAP existing MCP tools +
// CLI subcommands and carry NO new product logic.
//
// This test enforces Anthropic's Agent Skills best practices as acceptance criteria:
//   1. kebab folder; file exactly SKILL.md; no README.md inside; name has no "claude"/"anthropic";
//      no angle brackets in frontmatter.
//   2. description (<=1024 chars) is the trigger mechanism: explicit "Use when" phrases,
//      named capabilities, and a "Do NOT use" disambiguation clause (anti over-trigger).
//   3. progressive disclosure: lean body links references/*.md with paths that resolve.
//   4. body ends with a self-verify quality checklist; states it adds "no new logic".
//   5. trigger matrix: should-trigger phrases are covered by the description (activation proxy);
//      over-trigger guarded by a Do-NOT clause naming a sibling skill.
//
// Activation/output-consistency across live runs can't execute in CI; the should-trigger matrix
// below is the static proxy (every documented trigger phrase must appear verbatim in the
// description), and the structural checks (fixed Example + Quality checklist) underpin consistency.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const { TOOLS } = require(path.join(ROOT, 'scripts', 'tool-registry.js'));
const MCP_TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

const CLI_SUBCOMMANDS = (() => {
  const cli = fs.readFileSync(path.join(ROOT, 'bin', 'cli.js'), 'utf8');
  const set = new Set();
  const re = /case\s+'([a-z][a-z0-9-]*)'/g;
  let m;
  while ((m = re.exec(cli)) !== null) set.add(m[1]);
  return set;
})();

// The new auto-trigger skill set (mirrors the 5 slash-commands; 4–6 by design).
const NEW_SKILLS = [
  'thumbgate-guard',
  'thumbgate-rules',
  'thumbgate-blocked',
  'thumbgate-protect',
  'thumbgate-doctor',
];

// Should-trigger matrix: each phrase MUST appear (case-insensitive) in the skill's description.
// 100% coverage here clears the >=90% activation bar via the description-discovery mechanism.
const TRIGGER_MATRIX = {
  'thumbgate-guard': [
    'never do that again',
    'block this from happening again',
    'make that a rule',
    'guard against this',
    'stop the agent from repeating that',
  ],
  'thumbgate-rules': [
    'what is ThumbGate protecting me from',
    'show my rules',
    'show my gates',
    'what has the agent learned',
    'list active guardrails',
  ],
  'thumbgate-blocked': [
    'what has ThumbGate blocked',
    'show gate stats',
    'how many tokens did we save',
    'show the enforcement matrix',
    'is enforcement working',
  ],
  'thumbgate-protect': [
    'is main protected',
    'show branch governance',
    'approve this protected change',
    'let me edit a protected file',
    'what am I blocked from editing',
  ],
  'thumbgate-doctor': [
    'is ThumbGate wired up',
    'thumbgate doctor',
    "why aren't my gates firing",
    'is the MCP server connected',
    'agent readiness',
  ],
};

// Sibling-skill names a Do-NOT clause may legitimately reference for disambiguation.
const SIBLING_NAMES = [
  'thumbgate-guard',
  'thumbgate-rules',
  'thumbgate-blocked',
  'thumbgate-protect',
  'thumbgate-doctor',
  'thumbgate-feedback',
  'Agent Memory',
];

function parseFrontmatter(content) {
  assert.ok(content.startsWith('---'), 'must start with frontmatter delimiter');
  const end = content.indexOf('\n---', 3);
  assert.ok(end > 0, 'must have a closing frontmatter delimiter');
  const block = content.slice(3, end);
  const fields = {};
  const keys = [];
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    keys.push(key);
    fields[key] = line.slice(idx + 1).trim();
  }
  return { fields, keys, body: content.slice(end + 4) };
}

function bodyReferencesARealTool(body) {
  for (const name of MCP_TOOL_NAMES) {
    if (body.includes(name)) return true;
  }
  const re = /npx thumbgate ([a-z][a-z0-9-]*)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (CLI_SUBCOMMANDS.has(m[1])) return true;
  }
  return false;
}

describe('discoverable /thumbgate-* SKILLS (auto-trigger surface)', () => {
  test('the new skill set is 4–6 (tight scope)', () => {
    assert.ok(NEW_SKILLS.length >= 4 && NEW_SKILLS.length <= 6, `got ${NEW_SKILLS.length}`);
  });

  for (const name of NEW_SKILLS) {
    describe(`skills/${name}`, () => {
      const dir = path.join(SKILLS_DIR, name);
      const file = path.join(dir, 'SKILL.md');

      test('folder is kebab-case and contains exactly SKILL.md (no README.md)', () => {
        assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'folder name is kebab-case');
        assert.ok(fs.existsSync(file), `${name}/SKILL.md must exist`);
        assert.ok(!fs.existsSync(path.join(dir, 'README.md')), 'no README.md inside the skill folder');
      });

      test('frontmatter is spec-pure (name + description only, clean name, no angle brackets)', () => {
        const raw = fs.readFileSync(file, 'utf8');
        const { fields, keys } = parseFrontmatter(raw);
        assert.deepEqual([...keys].sort(), ['description', 'name'], 'only name + description keys');
        assert.equal(fields.name, name, 'name matches folder');
        assert.ok(!/claude|anthropic/i.test(fields.name), 'name has no claude/anthropic');
        const fmBlock = raw.slice(0, raw.indexOf('\n---', 3));
        assert.ok(!/[<>]/.test(fmBlock), 'no XML angle brackets in frontmatter');
      });

      test('description is the trigger mechanism: <=1024 chars, "Use when" + "Do NOT use"', () => {
        const { fields } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
        const d = fields.description;
        assert.ok(d.length >= 200, 'substantive description');
        assert.ok(d.length <= 1024, `description <=1024 chars (got ${d.length})`);
        assert.match(d, /Use when/i, 'has explicit "Use when" trigger phrases');
        assert.match(d, /Do NOT use/i, 'has a "Do NOT use" disambiguation clause (anti over-trigger)');
      });

      test('Do-NOT clause names a sibling skill (over-trigger boundary)', () => {
        const { fields } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
        const others = SIBLING_NAMES.filter((s) => s !== name);
        assert.ok(others.some((s) => fields.description.includes(s)),
          'description points over-trigger cases to a sibling skill');
      });

      test('body wraps a REAL MCP tool or CLI subcommand and declares no new logic', () => {
        const { body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
        assert.ok(bodyReferencesARealTool(body), 'references a registered MCP tool or real CLI subcommand');
        assert.ok(/no new logic/i.test(body), 'states it adds no new logic (repackaging only)');
      });

      test('progressive disclosure: body links a references/ doc that resolves', () => {
        const { body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
        const links = [...body.matchAll(/\(references\/([A-Za-z0-9._-]+\.md)\)/g)].map((m) => m[1]);
        assert.ok(links.length >= 1, 'links at least one references/ doc');
        for (const rel of links) {
          assert.ok(fs.existsSync(path.join(dir, 'references', rel)), `references/${rel} exists`);
        }
      });

      test('ends with a self-verify quality checklist and a concrete Example', () => {
        const body = fs.readFileSync(file, 'utf8');
        assert.match(body, /## Quality checklist/i, 'has a Quality checklist section');
        assert.match(body, /- \[ \] /, 'checklist has verifiable items');
        assert.match(body, /## Example/i, 'has a concrete input→action Example (output consistency)');
      });

      test('should-trigger matrix: every documented trigger phrase is in the description', () => {
        const { fields } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
        const d = fields.description.toLowerCase();
        const phrases = TRIGGER_MATRIX[name];
        assert.ok(phrases && phrases.length >= 4, 'has a documented trigger set');
        const hits = phrases.filter((p) => d.includes(p.toLowerCase())).length;
        assert.equal(hits, phrases.length,
          `all ${phrases.length} should-trigger phrases must appear (got ${hits})`);
      });
    });
  }
});

describe('antipattern description fixes (2026-06-11)', () => {
  function descOf(skill) {
    const raw = fs.readFileSync(path.join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
    return parseFrontmatter(raw).fields.description;
  }

  test('solve-architecture-autonomy: narrow + explicit triggers + Do NOT (no longer keyword-stuffed)', () => {
    const d = descOf('solve-architecture-autonomy');
    assert.match(d, /Use when/i, 'has explicit triggers');
    assert.match(d, /Do NOT use/i, 'has a Do NOT use clause');
    assert.ok(d.length <= 1024, 'description within limit');
    // Old over-broad signature is gone.
    assert.ok(!/patterns efficiently/i.test(d), 'drops the keyword-stuffed "patterns efficiently" tail');
    const commaKeywords = (d.match(/,/g) || []).length;
    assert.ok(!(commaKeywords >= 10 && /architecture, autonomy, crisis/i.test(d)),
      'no longer a 15-keyword comma list');
  });

  test('Agent Memory: explicit trigger phrases + Do NOT use clause added', () => {
    const d = descOf('agent-memory');
    assert.match(d, /Use when/i, 'has explicit "Use when" triggers');
    assert.match(d, /Do NOT use/i, 'has a Do NOT use disambiguation clause');
    assert.ok(d.length <= 1024, 'description within limit');
  });

  test('ThumbGate Brand Voice: explicit trigger phrases + Do NOT use clause added', () => {
    const d = descOf('thumbgate-brand-voice');
    assert.match(d, /Use when|Use BEFORE/i, 'has explicit trigger phrasing');
    assert.match(d, /Do NOT use/i, 'has a Do NOT use clause');
    assert.ok(d.length <= 1024, 'description within limit');
  });
});
