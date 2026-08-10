#!/usr/bin/env node
'use strict';

/**
 * prove-herdr-adapter.js — Prove Herdr terminal multiplexer governance plugin manifest.
 */

const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_PATH = path.join(__dirname, '..', 'adapters', 'herdr', 'herdr-plugin.toml');

function verifyHerdrPlugin() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { ok: false, error: `manifest missing at ${MANIFEST_PATH}` };
  }
  const content = fs.readFileSync(MANIFEST_PATH, 'utf8');

  const idMatch = content.match(/^id\s*=\s*"(.*?)"/m);
  const nameMatch = content.match(/^name\s*=\s*"(.*?)"/m);
  const versionMatch = content.match(/^version\s*=\s*"(.*?)"/m);
  const minHerdrMatch = content.match(/^minHerdrVersion\s*=\s*"(.*?)"/m);
  const categoryMatch = content.match(/^category\s*=\s*"(.*?)"/m);
  const commandMatch = content.match(/^command\s*=\s*"(.*?)"/m);

  if (!idMatch || !nameMatch || !versionMatch || !minHerdrMatch || !categoryMatch || !commandMatch) {
    return { ok: false, error: 'missing required fields in herdr-plugin.toml' };
  }

  const pluginId = idMatch[1];
  if (pluginId !== 'thumbgate-approvals') {
    return { ok: false, error: `expected plugin id thumbgate-approvals, got ${pluginId}` };
  }

  return {
    ok: true,
    pluginId,
    pluginName: nameMatch[1],
    version: versionMatch[1],
    category: categoryMatch[1],
    mcpCommand: commandMatch[1],
    mcpArgs: ['--yes', '--package', `thumbgate@${versionMatch[1]}`, 'thumbgate', 'serve'],
  };
}

if (process.argv[1] && require('node:path').resolve(process.argv[1]) === require('node:path').resolve(__filename)) {
  const res = verifyHerdrPlugin();
  process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
  process.exit(res.ok ? 0 : 1);
}

module.exports = { verifyHerdrPlugin, MANIFEST_PATH };
