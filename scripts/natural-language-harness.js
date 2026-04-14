#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  getSetting,
  getSettingOrigin,
} = require('./settings-hierarchy');

const HARNESS_DIR = path.join(__dirname, '..', 'docs', 'harnesses');
const REQUIRED_SECTIONS = ['Purpose', 'Steps', 'Success Evidence'];

function slugify(value, fallback) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function renderTemplate(template, inputs) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(inputs, key)) {
      return String(inputs[key]);
    }
    return '';
  });
}

function parseFrontmatter(source, sourcePath) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    throw new Error(`Harness ${sourcePath} must start with JSON frontmatter`);
  }

  let metadata;
  try {
    metadata = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`Harness ${sourcePath} has invalid JSON frontmatter: ${error.message}`);
  }

  return {
    metadata,
    body: source.slice(match[0].length),
  };
}

function parseSections(body) {
  const sections = {};
  let current = null;

  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1].trim();
      sections[current] = [];
      continue;
    }

    if (current) {
      sections[current].push(line);
    }
  }

  return Object.fromEntries(
    Object.entries(sections).map(([key, lines]) => [key, lines.join('\n').trim()]),
  );
}

function extractListItems(sectionBody) {
  return String(sectionBody || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim())
    .filter(Boolean);
}

function resolveInputs(inputSchema = {}, overrides = {}) {
  const resolved = {};

  for (const [key, schema] of Object.entries(inputSchema || {})) {
    const normalized = (schema && typeof schema === 'object' && !Array.isArray(schema))
      ? schema
      : { default: schema };

    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      resolved[key] = overrides[key];
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(normalized, 'default')) {
      resolved[key] = normalized.default;
      continue;
    }

    if (normalized.required) {
      throw new Error(`Missing required harness input: ${key}`);
    }
  }

  for (const [key, value] of Object.entries(overrides || {})) {
    if (!Object.prototype.hasOwnProperty.call(resolved, key)) {
      resolved[key] = value;
    }
  }

  return resolved;
}

function parseHarnessSource(source, sourcePath) {
  const { metadata, body } = parseFrontmatter(source, sourcePath);
  const sections = parseSections(body);

  for (const section of REQUIRED_SECTIONS) {
    if (!sections[section]) {
      throw new Error(`Harness ${sourcePath} is missing required section "${section}"`);
    }
  }

  if (!metadata.id || !metadata.title) {
    throw new Error(`Harness ${sourcePath} must define id and title in frontmatter`);
  }

  const steps = extractListItems(sections['Steps']);
  const successEvidence = extractListItems(sections['Success Evidence']);
  if (steps.length === 0) {
    throw new Error(`Harness ${sourcePath} must define at least one step`);
  }
  if (successEvidence.length === 0) {
    throw new Error(`Harness ${sourcePath} must define at least one success-evidence bullet`);
  }

  return {
    id: metadata.id,
    title: metadata.title,
    description: metadata.description || sections['Purpose'],
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    inputSchema: metadata.inputs || {},
    purpose: sections['Purpose'],
    steps,
    successEvidence,
    sourcePath,
  };
}

function loadHarnessFile(sourcePath) {
  return parseHarnessSource(fs.readFileSync(sourcePath, 'utf8'), sourcePath);
}

function loadHarnesses(options = {}) {
  if (!fs.existsSync(HARNESS_DIR)) {
    return [];
  }

  const harnesses = fs.readdirSync(HARNESS_DIR)
    .filter((entry) => entry.endsWith('.md'))
    .sort()
    .map((entry) => loadHarnessFile(path.join(HARNESS_DIR, entry)));

  if (options.tag) {
    return harnesses.filter((harness) => harness.tags.includes(String(options.tag)));
  }

  return harnesses;
}

function listHarnesses(options = {}) {
  return loadHarnesses(options).map((harness) => ({
    id: harness.id,
    title: harness.title,
    description: harness.description,
    tags: harness.tags,
    inputs: Object.keys(harness.inputSchema),
    sourcePath: harness.sourcePath,
  }));
}

function getHarness(identifier) {
  const key = String(identifier || '').trim();
  const harness = loadHarnesses().find((entry) => {
    const basename = path.basename(entry.sourcePath, path.extname(entry.sourcePath));
    return entry.id === key || basename === key;
  });

  if (!harness) {
    throw new Error(`Unknown harness: ${identifier}`);
  }

  return harness;
}

function renderHarnessPlan(identifier, inputOverrides = {}) {
  const harness = getHarness(identifier);
  const resolvedInputs = resolveInputs(harness.inputSchema, inputOverrides);

  return {
    ...harness,
    resolvedInputs,
    purpose: renderTemplate(harness.purpose, resolvedInputs),
    steps: harness.steps.map((step) => renderTemplate(step, resolvedInputs)),
    successEvidence: harness.successEvidence.map((line) => renderTemplate(line, resolvedInputs)),
  };
}

function extractCommand(step) {
  const exact = step.match(/^(?:Run|Execute|Command):\s*`([^`]+)`\s*$/i);
  if (exact) {
    return exact[1];
  }

  const inline = step.match(/^(?:Run|Execute|Command)\b.*?`([^`]+)`/i);
  return inline ? inline[1] : null;
}

function buildHarnessJob(identifier, inputOverrides = {}, options = {}) {
  const plan = renderHarnessPlan(identifier, inputOverrides);
  const settingsOptions = options.settingsOptions || {};
  const runtimePolicy = {
    enabled: Boolean(getSetting('harnesses.enabled', settingsOptions)),
    allowRuntimeExecution: Boolean(getSetting('harnesses.allowRuntimeExecution', settingsOptions)),
    origins: {
      enabled: getSettingOrigin('harnesses.enabled', settingsOptions),
      allowRuntimeExecution: getSettingOrigin('harnesses.allowRuntimeExecution', settingsOptions),
    },
  };
  const summary = [
    `Harness: ${plan.title}`,
    `Harness ID: ${plan.id}`,
    `Purpose: ${plan.purpose}`,
  ];

  if (Object.keys(plan.resolvedInputs).length > 0) {
    summary.push(`Inputs:\n${JSON.stringify(plan.resolvedInputs, null, 2)}`);
  }

  const stages = [
    {
      name: 'harness_brief',
      context: summary.join('\n\n'),
    },
  ];

  plan.steps.forEach((step, index) => {
    const command = extractCommand(step);
    const name = slugify(step.split(/[.:]/)[0], `step_${index + 1}`);
    if (command) {
      stages.push({ name, command });
      return;
    }
    stages.push({ name, appendContext: step });
  });

  stages.push({
    name: 'success_evidence',
    appendContext: [
      'Success evidence required:',
      ...plan.successEvidence.map((line) => `- ${line}`),
    ].join('\n'),
  });

  return {
    id: options.jobId || `harness-${plan.id}`,
    tags: Array.from(new Set([...(plan.tags || []), 'natural-language-harness', plan.id])),
    skill: options.skill || 'natural-language-harness',
    partnerProfile: options.partnerProfile || null,
    autoImprove: options.autoImprove !== false,
    stages,
    harnessId: plan.id,
    harnessSourcePath: plan.sourcePath,
    runtimePolicy,
  };
}

function runHarness(identifier, inputOverrides = {}, options = {}) {
  const settingsOptions = options.settingsOptions || {};
  if (!getSetting('harnesses.enabled', settingsOptions)) {
    throw new Error('Natural-language harnesses are disabled by the settings hierarchy');
  }
  if (!getSetting('harnesses.allowRuntimeExecution', settingsOptions)) {
    throw new Error('Natural-language harness runtime execution is disabled by the settings hierarchy');
  }
  const { executeJob } = require('./async-job-runner');
  return executeJob(buildHarnessJob(identifier, inputOverrides, options), options);
}

function runCli(argv) {
  const [command, identifier, rawInputs] = argv.slice(2);

  if (command === 'list') {
    console.log(JSON.stringify({ harnesses: listHarnesses() }, null, 2));
    return;
  }

  if (command === 'render') {
    const inputs = rawInputs ? JSON.parse(rawInputs) : {};
    console.log(JSON.stringify(renderHarnessPlan(identifier, inputs), null, 2));
    return;
  }

  throw new Error('Usage: node scripts/natural-language-harness.js <list|render> [harnessId] [jsonInputs]');
}

if (require.main === module) {
  try {
    runCli(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  HARNESS_DIR,
  REQUIRED_SECTIONS,
  buildHarnessJob,
  getHarness,
  listHarnesses,
  loadHarnesses,
  loadHarnessFile,
  parseHarnessSource,
  renderHarnessPlan,
  renderTemplate,
  resolveInputs,
  runCli,
  runHarness,
};
