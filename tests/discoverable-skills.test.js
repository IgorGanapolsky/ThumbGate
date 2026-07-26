#!/usr/bin/env node
'use strict';

// discoverable-skills.test.js — guards the discoverable /thumbgate-* slash-commands.
//
// These commands exist for distribution: they surface ThumbGate's core enforcement
// value in the agent command palette (the way GSD surfaces /gsd-*), instead of
// hiding it behind MCP tools nobody browses. They are thin wrappers — this test
// proves they (a) are well-formed, (b) reference ONLY real MCP tools + real CLI
// subcommands, and (c) carry no new product logic.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const COMMANDS_DIR = path.join(ROOT, '.claude', 'commands');
const { TOOLS } = require(path.join(ROOT, 'scripts', 'tool-registry.js'));

// The discoverable wrapper set (4–6 by design — keep it tight).
const COMMANDS = [
  'thumbgate-dashboard',
  'thumbgate-guard',
  'thumbgate-rules',
  'thumbgate-blocked',
  'thumbgate-protect',
  'thumbgate-doctor',
];

const MCP_TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

// Real CLI subcommands = the `case '<sub>':` labels in bin/cli.js.
const CLI_SUBCOMMANDS = (() => {
  const cli = fs.readFileSync(path.join(ROOT, 'bin', 'cli.js'), 'utf8');
  const set = new Set();
  const re = /case\s+'([a-z][a-z0-9-]*)'/g;
  let m;
  while ((m = re.exec(cli)) !== null) set.add(m[1]);
  return set;
})();

function parseFrontmatter(content) {
  assert.ok(content.startsWith('---'), 'must start with frontmatter delimiter');
  const end = content.indexOf('\n---', 3);
  assert.ok(end > 0, 'must have a closing frontmatter delimiter');
  const block = content.slice(3, end);
  const fields = {};
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    fields[key] = line.slice(idx + 1).trim();
  }
  return { fields, body: content.slice(end + 4) };
}

function parseAllowedTools(value) {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

describe('discoverable /thumbgate-* slash-commands', () => {
  test('the wrapper set is 4–6 commands (tight scope)', () => {
    assert.ok(COMMANDS.length >= 4 && COMMANDS.length <= 6, `got ${COMMANDS.length} commands`);
  });

  for (const name of COMMANDS) {
    describe(`/${name}`, () => {
      const file = path.join(COMMANDS_DIR, `${name}.md`);

      test('file exists in the plugin command path (.claude/commands)', () => {
        assert.ok(fs.existsSync(file), `${name}.md must exist in .claude/commands/`);
      });

      test('has valid frontmatter with name, description, allowed-tools', () => {
        const { fields } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
        assert.equal(fields.name, name, 'name field matches filename');
        assert.ok(name.startsWith('thumbgate-'), 'follows the thumbgate- prefix convention');
        assert.ok(fields.description && fields.description.length >= 40, 'has a substantive description');
        assert.ok(fields['allowed-tools'], 'declares allowed-tools');
      });

      test('allowed-tools reference ONLY real MCP tools and real CLI subcommands', () => {
        const { fields } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
        const tools = parseAllowedTools(fields['allowed-tools']);
        assert.ok(tools.length >= 1, 'declares at least one tool');

        for (const tool of tools) {
          const mcp = tool.match(/^mcp__thumbgate__([a-z0-9_]+)$/);
          const bash = tool.match(/^Bash\(npx thumbgate ([a-z][a-z0-9-]*)/);
          if (mcp) {
            assert.ok(MCP_TOOL_NAMES.has(mcp[1]), `MCP tool "${mcp[1]}" must be a registered ThumbGate tool`);
          } else if (bash) {
            assert.ok(CLI_SUBCOMMANDS.has(bash[1]), `CLI subcommand "${bash[1]}" must exist in bin/cli.js`);
          } else {
            assert.fail(`allowed-tools entry "${tool}" is not a recognized MCP tool or thumbgate CLI Bash pattern`);
          }
        }
      });

      test('body references at least one of its declared tools (real wrapper, not a stub)', () => {
        const content = fs.readFileSync(file, 'utf8');
        const { fields, body } = parseFrontmatter(content);
        const tools = parseAllowedTools(fields['allowed-tools']);
        const referenced = tools.some((tool) => {
          const mcp = tool.match(/^mcp__thumbgate__([a-z0-9_]+)$/);
          const bash = tool.match(/^Bash\(npx thumbgate ([a-z][a-z0-9-]*)/);
          if (mcp) return body.includes(mcp[1]);
          if (bash) return body.includes(`thumbgate ${bash[1]}`);
          return false;
        });
        assert.ok(referenced, 'body must invoke at least one declared tool/CLI');
      });

      test('declares it adds no new logic (repackaging only)', () => {
        const body = fs.readFileSync(file, 'utf8').toLowerCase();
        assert.ok(body.includes('no new logic'), 'states it wraps existing capability without new logic');
      });
    });
  }

  test('README positions the commands as the guardrail layer for spec-driven agents', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    assert.match(readme, /guardrail layer for spec-driven agents/i, 'has the positioning line');
    assert.match(readme, /GSD/, 'mentions GSD');
    assert.match(readme, /Spec[- ]?Kit/i, 'mentions Spec-Kit');
    for (const name of COMMANDS) {
      assert.ok(readme.includes(`/${name}`), `README documents /${name}`);
    }
  });
});
