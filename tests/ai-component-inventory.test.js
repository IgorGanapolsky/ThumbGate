'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  scanAiComponents,
  buildCycloneDxMlBom,
  formatInventoryText,
} = require('../scripts/ai-component-inventory');
const { TOOLS } = require('../scripts/tool-registry');

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-ai-inventory-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    dependencies: {
      '@anthropic-ai/sdk': '^0.50.0',
      '@google-cloud/dialogflow-cx': '^5.0.0',
      '@pinecone-database/pinecone': '^6.0.0',
    },
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'agent.py'), [
    'from openai import OpenAI',
    'import vertexai',
    'from sentence_transformers import SentenceTransformer',
    'from qdrant_client import QdrantClient',
    'client = OpenAI()',
  ].join('\n'));
  fs.mkdirSync(path.join(dir, 'models'));
  fs.writeFileSync(path.join(dir, 'models', 'intent.onnx'), 'fake model bytes');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'ignored.js'), 'import torch');
  return dir;
}

test('scanAiComponents finds enterprise AI evidence without scanning ignored dirs', () => {
  const dir = tempProject();
  const inventory = scanAiComponents({ rootDir: dir });
  const ids = new Set(inventory.components.map((item) => item.id));

  assert.equal(inventory.schemaVersion, 'thumbgate.ai-inventory.v1');
  assert.ok(ids.has('openai'));
  assert.ok(ids.has('vertex-ai'));
  assert.ok(ids.has('dialogflow-cx'));
  assert.ok(ids.has('pinecone'));
  assert.ok(ids.has('qdrant'));
  assert.ok(ids.has('sentence-transformers'));
  assert.ok(ids.has('onnx-onnx-artifact'));
  assert.equal(ids.has('pytorch'), false, 'ignored node_modules source must not count');

  const openai = inventory.components.find((item) => item.id === 'openai');
  assert.equal(openai.evidence[0].file, 'agent.py');
  assert.equal(openai.evidence[0].line, 1);
});

test('buildCycloneDxMlBom exports ML-BOM style evidence properties', () => {
  const dir = tempProject();
  const inventory = scanAiComponents({ rootDir: dir, includeSnippets: false });
  const bom = buildCycloneDxMlBom(inventory, { version: 'test' });

  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.equal(bom.specVersion, '1.5');
  assert.ok(bom.components.some((item) => item.type === 'machine-learning-model'));
  assert.ok(bom.components.some((item) => item.bomRef === 'thumbgate:dialogflow-cx'));
  assert.ok(bom.metadata.properties.some((item) => item.name === 'thumbgate:componentCount'));
});

test('formatInventoryText provides compact operator evidence', () => {
  const dir = tempProject();
  const text = formatInventoryText(scanAiComponents({ rootDir: dir }));

  assert.match(text, /ThumbGate AI Component Inventory/);
  assert.match(text, /Google Dialogflow CX/);
  assert.match(text, /agent\.py:1/);
});

test('cli ai-inventory emits JSON and CycloneDX files', () => {
  const dir = tempProject();
  const cli = path.join(__dirname, '..', 'bin', 'cli.js');
  const jsonOut = execFileSync(process.execPath, [cli, 'ai-inventory', '--root', dir, '--json'], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(jsonOut);
  assert.ok(parsed.components.some((item) => item.id === 'vertex-ai'));

  const output = path.join(dir, '.thumbgate', 'ai-mlbom.json');
  execFileSync(process.execPath, [cli, 'ai-inventory', '--root', dir, '--format=cyclonedx', '--output', output], {
    encoding: 'utf8',
  });
  const bom = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(bom.bomFormat, 'CycloneDX');
});

test('MCP tool exposes AI inventory early in the tool schema', () => {
  const index = TOOLS.findIndex((tool) => tool.name === 'ai_component_inventory');
  assert.ok(index >= 0, 'ai_component_inventory tool should be registered');
  assert.ok(index < 8, 'ai_component_inventory should appear before likely tool-schema truncation');
  assert.equal(TOOLS[index].annotations.readOnlyHint, true);
});
