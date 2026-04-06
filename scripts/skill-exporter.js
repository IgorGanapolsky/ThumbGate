#!/usr/bin/env node
'use strict';

/**
 * Skill Exporter — compiles ThumbGate profiles/policy-bundles into
 * OpenAI Skill definitions and Codex Plugin manifests.
 * Vendor-neutral IR → target format compilation.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKILL_SPECS_DIR = path.join(ROOT, 'config', 'skill-specs');
const POLICY_BUNDLES_DIR = path.join(ROOT, 'config', 'policy-bundles');
const DIST_DIR = path.join(ROOT, 'dist', 'skills');
const PKG = require(path.join(ROOT, 'package.json'));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Load a SkillSpec by name from config/skill-specs/.
 * @param {string} name - spec name (without .json)
 * @returns {object} parsed SkillSpec
 */
function loadSkillSpec(name) {
  const specPath = path.join(SKILL_SPECS_DIR, `${name}.json`);
  if (!fs.existsSync(specPath)) {
    throw new Error(`Skill spec not found: ${name} (looked at ${specPath})`);
  }
  return readJson(specPath);
}

/**
 * List all available skill specs in config/skill-specs/.
 * @returns {string[]} spec names (without .json extension)
 */
function listAvailableSpecs() {
  if (!fs.existsSync(SKILL_SPECS_DIR)) return [];
  return fs.readdirSync(SKILL_SPECS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

/**
 * Load a policy bundle by bundleId.
 * @param {string} bundleId
 * @returns {object} parsed policy bundle
 */
function loadPolicyBundle(bundleId) {
  const bundlePath = path.join(POLICY_BUNDLES_DIR, `${bundleId}.json`);
  if (!fs.existsSync(bundlePath)) return null;
  return readJson(bundlePath);
}

/**
 * Build instruction text from a policy bundle and escalation rules.
 * @param {object} bundle - parsed policy bundle
 * @param {string[]} escalationRules
 * @returns {string} instruction text
 */
function buildInstructions(bundle, escalationRules) {
  const lines = [];
  lines.push(`Policy: ${bundle.description}`);
  lines.push(`Default MCP Profile: ${bundle.defaultMcpProfile}`);
  lines.push('');
  lines.push('## Approval Gates');
  lines.push(`Required risk levels for approval: ${bundle.approval.requiredRisks.join(', ')}`);
  lines.push('');
  lines.push('## Available Intents');
  for (const intent of bundle.intents) {
    const actions = intent.actions.map((a) => a.name).join(', ');
    lines.push(`- ${intent.id} [${intent.risk}]: ${intent.description} (${actions})`);
  }
  if (escalationRules.length > 0) {
    lines.push('');
    lines.push('## Escalation Rules');
    for (const rule of escalationRules) {
      lines.push(`- ${rule}`);
    }
  }
  return lines.join('\n');
}

/**
 * Compile a SkillSpec into an OpenAI Skill definition.
 * @param {object} spec - parsed SkillSpec
 * @returns {object} OpenAI Skill JSON
 */
function compileToOpenAISkill(spec) {
  const bundle = loadPolicyBundle(spec.policyBundle);
  const instructions = bundle
    ? buildInstructions(bundle, spec.escalationRules || [])
    : `Skill: ${spec.description}`;

  return {
    name: spec.name,
    description: spec.description,
    model_class: spec.defaultModelClass,
    instructions,
    scripts: {
      gate_check: `recall --scope ${(spec.memoryScope || []).join(',')} --enforce`,
      recall_injection: `recall --query "{{context}}" --scope ${(spec.memoryScope || []).join(',')}`
    },
    assets: {
      prevention_rules: `config/policy-bundles/${spec.policyBundle}.json`,
      memory_scope: spec.memoryScope || [],
      tools: spec.tools || []
    }
  };
}

/**
 * Compile a SkillSpec into a Codex Plugin manifest.
 * @param {object} spec - parsed SkillSpec
 * @returns {object} { pluginJson, mcpJson, agentsMd }
 */
function compileToCodexPlugin(spec) {
  const bundle = loadPolicyBundle(spec.policyBundle);
  const instructions = bundle
    ? buildInstructions(bundle, spec.escalationRules || [])
    : `Skill: ${spec.description}`;

  const pluginJson = {
    name: spec.name,
    version: PKG.version,
    description: spec.description,
    author: {
      name: PKG.author,
      url: 'https://github.com/IgorGanapolsky'
    },
    homepage: PKG.homepage,
    repository: PKG.repository.url.replace(/\.git$/, ''),
    license: PKG.license,
    keywords: ['codex', 'codex-plugin', 'thumbgate', spec.name, ...(spec.memoryScope || [])],
    mcpServers: './.mcp.json',
    interface: {
      displayName: `ThumbGate: ${spec.name}`,
      shortDescription: spec.description,
      longDescription: instructions,
      developerName: PKG.author,
      category: 'Developer Tools',
      capabilities: ['Interactive', 'Write'],
      websiteURL: PKG.homepage,
      brandColor: '#0ea5e9'
    }
  };

  const mcpJson = {
    mcpServers: {
      thumbgate: {
        command: 'npx',
        args: ['-y', `thumbgate@${PKG.version}`, 'serve'],
        tools: spec.tools || []
      }
    }
  };

  const agentsMdLines = [
    `# ${spec.name} — ThumbGate Codex Plugin`,
    '',
    '## Trigger',
    'If user gives explicit positive/negative outcome feedback, capture it immediately.',
    '',
    '## Memory Scope',
    ...(spec.memoryScope || []).map((s) => `- ${s}`),
    '',
    '## Gating Instructions',
    instructions,
    '',
    '## Session Start',
    '',
    '```bash',
    'npm run feedback:summary',
    'npm run feedback:rules',
    '```',
    '',
    'Use generated rules as hard guardrails to avoid repeated mistakes.'
  ];

  return {
    pluginJson,
    mcpJson,
    agentsMd: agentsMdLines.join('\n')
  };
}

/**
 * Export a skill spec to the given target formats.
 * @param {string} name - spec name
 * @param {string[]} targets - array of 'openai' and/or 'codex'
 * @returns {{ openai?: object, codex?: object, written: string[] }}
 */
function exportSkill(name, targets = ['openai', 'codex']) {
  const spec = loadSkillSpec(name);
  const result = { written: [] };
  const outDir = path.join(DIST_DIR, name);
  ensureDir(outDir);

  if (targets.includes('openai')) {
    const openai = compileToOpenAISkill(spec);
    result.openai = openai;
    const openaiPath = path.join(outDir, 'openai-skill.json');
    fs.writeFileSync(openaiPath, JSON.stringify(openai, null, 2) + '\n');
    result.written.push(openaiPath);
  }

  if (targets.includes('codex')) {
    const codex = compileToCodexPlugin(spec);
    result.codex = codex;
    const codexDir = path.join(outDir, 'codex');
    ensureDir(path.join(codexDir, '.codex-plugin'));

    const pluginPath = path.join(codexDir, '.codex-plugin', 'plugin.json');
    fs.writeFileSync(pluginPath, JSON.stringify(codex.pluginJson, null, 2) + '\n');
    result.written.push(pluginPath);

    const mcpPath = path.join(codexDir, '.mcp.json');
    fs.writeFileSync(mcpPath, JSON.stringify(codex.mcpJson, null, 2) + '\n');
    result.written.push(mcpPath);

    const agentsPath = path.join(codexDir, 'AGENTS.md');
    fs.writeFileSync(agentsPath, codex.agentsMd + '\n');
    result.written.push(agentsPath);
  }

  return result;
}

module.exports = { loadSkillSpec, compileToOpenAISkill, compileToCodexPlugin, exportSkill, listAvailableSpecs };

/* istanbul ignore next — CLI entry */
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'list';
  if (cmd === 'list') {
    const specs = listAvailableSpecs();
    console.log('Available skill specs:', specs.join(', '));
  } else if (cmd === 'export') {
    const name = args[1];
    if (!name) { console.error('Usage: skill-exporter.js export <name>'); process.exit(1); }
    const targets = args[2] ? args[2].split(',') : ['openai', 'codex'];
    const result = exportSkill(name, targets);
    console.log(`Exported ${name} → ${result.written.length} files`);
    result.written.forEach((f) => console.log(`  ${f}`));
  } else if (cmd === 'export-all') {
    const specs = listAvailableSpecs();
    for (const name of specs) {
      const result = exportSkill(name);
      console.log(`Exported ${name} → ${result.written.length} files`);
    }
  } else {
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
  }
}
