const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  loadSkillSpec,
  compileToOpenAISkill,
  compileToCodexPlugin,
  exportSkill,
  listAvailableSpecs
} = require('../scripts/skill-exporter');

const root = path.join(__dirname, '..');
const DIST_DIR = path.join(root, 'dist', 'skills');

function cleanDist(name) {
  const dir = path.join(DIST_DIR, name);
  fs.rmSync(dir, { recursive: true, force: true });
}

test('loadSkillSpec loads pr-reviewer spec correctly', () => {
  const spec = loadSkillSpec('pr-reviewer');
  assert.equal(spec.name, 'pr-reviewer');
  assert.equal(spec.description, 'Reviews pull requests with ThumbGate memory and gates');
  assert.deepEqual(spec.tools, ['recall', 'capture_feedback', 'search_lessons', 'enforcement_matrix']);
  assert.equal(spec.policyBundle, 'default-v1');
  assert.deepEqual(spec.memoryScope, ['pr-review', 'code-quality']);
  assert.equal(spec.defaultModelClass, 'mini');
  assert.deepEqual(spec.escalationRules, ['escalate-on-security-finding', 'escalate-on-breaking-change']);
});

test('loadSkillSpec throws for missing spec', () => {
  assert.throws(() => loadSkillSpec('nonexistent-spec-xyz'), /Skill spec not found/);
});

test('listAvailableSpecs returns all 3 specs', () => {
  const specs = listAvailableSpecs();
  assert.ok(specs.includes('pr-reviewer'), 'should include pr-reviewer');
  assert.ok(specs.includes('ticket-triage'), 'should include ticket-triage');
  assert.ok(specs.includes('release-status'), 'should include release-status');
  assert.ok(specs.length >= 3, `expected at least 3, got ${specs.length}`);
});

test('compileToOpenAISkill produces valid structure with name, description, instructions, model_class', () => {
  const spec = loadSkillSpec('pr-reviewer');
  const skill = compileToOpenAISkill(spec);
  assert.equal(skill.name, 'pr-reviewer');
  assert.equal(skill.description, 'Reviews pull requests with ThumbGate memory and gates');
  assert.equal(skill.model_class, 'mini');
  assert.equal(typeof skill.instructions, 'string');
  assert.ok(skill.instructions.length > 0);
  assert.ok(skill.scripts);
  assert.ok(skill.assets);
});

test('compileToOpenAISkill includes gate instructions from policy bundle', () => {
  const spec = loadSkillSpec('pr-reviewer');
  const skill = compileToOpenAISkill(spec);
  assert.match(skill.instructions, /Approval Gates/);
  assert.match(skill.instructions, /Available Intents/);
  assert.match(skill.instructions, /Balanced autonomous execution/);
});

test('compileToCodexPlugin produces plugin.json matching existing codex-profile format', () => {
  const spec = loadSkillSpec('pr-reviewer');
  const codex = compileToCodexPlugin(spec);
  const plugin = codex.pluginJson;

  // Matches structure of plugins/codex-profile/.codex-plugin/plugin.json
  assert.equal(plugin.name, 'pr-reviewer');
  assert.equal(typeof plugin.version, 'string');
  assert.equal(typeof plugin.description, 'string');
  assert.ok(plugin.author);
  assert.equal(typeof plugin.homepage, 'string');
  assert.equal(typeof plugin.repository, 'string');
  assert.equal(plugin.license, 'MIT');
  assert.ok(Array.isArray(plugin.keywords));
  assert.equal(plugin.mcpServers, './.mcp.json');
  assert.ok(plugin.interface);
  assert.equal(typeof plugin.interface.displayName, 'string');
  assert.equal(typeof plugin.interface.shortDescription, 'string');
  assert.equal(typeof plugin.interface.longDescription, 'string');
  assert.equal(plugin.interface.category, 'Developer Tools');
  assert.deepEqual(plugin.interface.capabilities, ['Interactive', 'Write']);
  assert.equal(plugin.interface.brandColor, '#0ea5e9');
});

test('compileToCodexPlugin includes .mcp.json with correct tool list', () => {
  const spec = loadSkillSpec('pr-reviewer');
  const codex = compileToCodexPlugin(spec);
  const mcp = codex.mcpJson;

  assert.ok(mcp.mcpServers);
  assert.ok(mcp.mcpServers.rlhf);
  assert.equal(mcp.mcpServers.rlhf.command, 'npx');
  assert.deepEqual(mcp.mcpServers.rlhf.tools, spec.tools);
});

test('exportSkill writes files to dist/skills/{name}/', () => {
  cleanDist('pr-reviewer');
  const result = exportSkill('pr-reviewer');

  assert.ok(result.openai);
  assert.ok(result.codex);
  assert.ok(result.written.length > 0);

  // Verify files exist on disk
  for (const file of result.written) {
    assert.ok(fs.existsSync(file), `expected file to exist: ${file}`);
  }

  // Check openai-skill.json
  const openaiPath = result.written.find((f) => f.includes('openai-skill.json'));
  assert.ok(openaiPath, 'should have written openai-skill.json');
  const openaiContent = JSON.parse(fs.readFileSync(openaiPath, 'utf8'));
  assert.equal(openaiContent.name, 'pr-reviewer');

  // Check plugin.json
  const pluginPath = result.written.find((f) => f.includes('plugin.json'));
  assert.ok(pluginPath, 'should have written plugin.json');

  // Check .mcp.json
  const mcpPath = result.written.find((f) => f.includes('.mcp.json'));
  assert.ok(mcpPath, 'should have written .mcp.json');

  // Check AGENTS.md
  const agentsPath = result.written.find((f) => f.includes('AGENTS.md'));
  assert.ok(agentsPath, 'should have written AGENTS.md');

  cleanDist('pr-reviewer');
});

test('exportSkill supports target filtering (openai only)', () => {
  cleanDist('ticket-triage');
  const result = exportSkill('ticket-triage', ['openai']);

  assert.ok(result.openai);
  assert.equal(result.codex, undefined);
  assert.equal(result.written.length, 1);
  assert.ok(result.written[0].includes('openai-skill.json'));

  cleanDist('ticket-triage');
});

test('exportSkill supports target filtering (codex only)', () => {
  cleanDist('release-status');
  const result = exportSkill('release-status', ['codex']);

  assert.equal(result.openai, undefined);
  assert.ok(result.codex);
  assert.ok(result.written.every((f) => !f.includes('openai-skill.json')));
  assert.ok(result.written.some((f) => f.includes('plugin.json')));

  cleanDist('release-status');
});

test('round-trip: spec → openai export → validate required fields present', () => {
  const specs = listAvailableSpecs();
  for (const name of specs) {
    const spec = loadSkillSpec(name);
    const skill = compileToOpenAISkill(spec);
    assert.equal(typeof skill.name, 'string', `${name}: name`);
    assert.equal(typeof skill.description, 'string', `${name}: description`);
    assert.equal(typeof skill.instructions, 'string', `${name}: instructions`);
    assert.equal(typeof skill.model_class, 'string', `${name}: model_class`);
    assert.ok(skill.scripts, `${name}: scripts`);
    assert.ok(skill.assets, `${name}: assets`);
  }
});

test('round-trip: spec → codex export → validate required fields present', () => {
  const specs = listAvailableSpecs();
  for (const name of specs) {
    const spec = loadSkillSpec(name);
    const codex = compileToCodexPlugin(spec);
    assert.equal(typeof codex.pluginJson.name, 'string', `${name}: plugin name`);
    assert.equal(typeof codex.pluginJson.version, 'string', `${name}: plugin version`);
    assert.equal(typeof codex.pluginJson.description, 'string', `${name}: plugin description`);
    assert.equal(codex.pluginJson.mcpServers, './.mcp.json', `${name}: mcpServers ref`);
    assert.ok(codex.mcpJson.mcpServers.rlhf, `${name}: mcp rlhf`);
    assert.equal(typeof codex.agentsMd, 'string', `${name}: AGENTS.md`);
  }
});

test('all 3 reference specs compile without error', () => {
  const names = ['pr-reviewer', 'ticket-triage', 'release-status'];
  for (const name of names) {
    assert.doesNotThrow(() => {
      const spec = loadSkillSpec(name);
      compileToOpenAISkill(spec);
      compileToCodexPlugin(spec);
    }, `${name} should compile without error`);
  }
});

test('default model class is preserved in exports', () => {
  const specs = [
    { name: 'pr-reviewer', expected: 'mini' },
    { name: 'ticket-triage', expected: 'nano' },
    { name: 'release-status', expected: 'nano' }
  ];

  for (const { name, expected } of specs) {
    const spec = loadSkillSpec(name);
    const openai = compileToOpenAISkill(spec);
    assert.equal(openai.model_class, expected, `${name}: openai model_class`);
  }
});

test('escalation rules appear in generated instructions', () => {
  const spec = loadSkillSpec('pr-reviewer');
  const openai = compileToOpenAISkill(spec);
  assert.match(openai.instructions, /Escalation Rules/);
  assert.match(openai.instructions, /escalate-on-security-finding/);
  assert.match(openai.instructions, /escalate-on-breaking-change/);

  // release-status has no escalation rules — should not contain section
  const releaseSpec = loadSkillSpec('release-status');
  const releaseSkill = compileToOpenAISkill(releaseSpec);
  assert.ok(!releaseSkill.instructions.includes('Escalation Rules'),
    'release-status should not have escalation rules section');
});
