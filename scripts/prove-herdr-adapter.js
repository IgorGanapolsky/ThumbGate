#!/usr/bin/env node
'use strict';

/**
 * prove-herdr-adapter.js — Prove Herdr terminal multiplexer governance plugin manifest.
 */

const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_PATH = path.join(__dirname, '..', 'adapters', 'herdr', 'herdr-plugin.toml');

function parseSimpleToml(content) {
  const result = {};
  let currentSection = result;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      const sectionName = line.slice(1, -1).trim();
      const parts = sectionName.split('.');
      let ptr = result;
      for (const p of parts) {
        if (!ptr[p]) ptr[p] = {};
        ptr = ptr[p];
      }
      currentSection = ptr;
      continue;
    }
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const key = line.slice(0, eqIdx).trim();
      const valStr = line.slice(eqIdx + 1).trim();
      let val;
      if (valStr.startsWith('"') && valStr.endsWith('"')) {
        val = valStr.slice(1, -1);
      } else if (valStr.startsWith('[') && valStr.endsWith(']')) {
        val = valStr.slice(1, -1).split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      } else {
        val = valStr;
      }
      currentSection[key] = val;
    }
  }
  return result;
}

function verifyHerdrPlugin() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { ok: false, error: `manifest missing at ${MANIFEST_PATH}` };
  }
  const content = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = parseSimpleToml(content);

  const plugin = parsed.plugin || {};
  const mcpServer = parsed.mcp_server || {};

  const requiredPluginKeys = ['id', 'name', 'version', 'minHerdrVersion', 'category'];
  const missingPlugin = requiredPluginKeys.filter(k => !plugin[k]);
  if (missingPlugin.length > 0) {
    return { ok: false, error: `missing plugin keys: ${missingPlugin.join(', ')}` };
  }

  if (plugin.id !== 'thumbgate-approvals') {
    return { ok: false, error: `expected plugin id thumbgate-approvals, got ${plugin.id}` };
  }
  if (!mcpServer.command || !Array.isArray(mcpServer.args) || !mcpServer.args.includes('serve')) {
    return { ok: false, error: 'invalid mcp_server configuration in herdr-plugin.toml' };
  }

  return {
    ok: true,
    pluginId: plugin.id,
    pluginName: plugin.name,
    version: plugin.version,
    category: plugin.category,
    mcpCommand: mcpServer.command,
    mcpArgs: mcpServer.args,
  };
}

if (require.main === module) {
  const res = verifyHerdrPlugin();
  process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
  process.exit(res.ok ? 0 : 1);
}

module.exports = { verifyHerdrPlugin, parseSimpleToml, MANIFEST_PATH };
