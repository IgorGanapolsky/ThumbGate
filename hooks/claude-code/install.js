#!/usr/bin/env node
/**
 * Install Claude Code hooks for rlhf-feedback-loop.
 *
 * Adds PreToolUse hook to ~/.claude/settings.local.json so that
 * pretool-inject.js runs before every tool call.
 *
 * Usage:
 *   node hooks/claude-code/install.js
 *   npx rlhf-feedback-loop install-hooks   (via CLI)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const SETTINGS_PATH = path.join(HOME, '.claude', 'settings.local.json');

const HOOK_ENTRY = {
  matcher: '*',
  hooks: [
    {
      type: 'command',
      command: 'node node_modules/rlhf-feedback-loop/hooks/claude-code/pretool-inject.js',
    },
  ],
};

function install() {
  let settings = {};

  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    } catch (_) {
      console.error('Warning: could not parse existing settings.local.json, creating new one');
      settings = {};
    }
  } else {
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  settings.hooks = settings.hooks || {};
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];

  // Check if already installed
  const existing = settings.hooks.PreToolUse.some(
    (entry) =>
      entry.hooks &&
      entry.hooks.some((h) => h.command && h.command.includes('pretool-inject.js')),
  );

  if (existing) {
    console.log('PreToolUse hook already installed in ' + SETTINGS_PATH);
    return false;
  }

  settings.hooks.PreToolUse.push(HOOK_ENTRY);
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  console.log('Installed PreToolUse hook in ' + SETTINGS_PATH);
  return true;
}

module.exports = { install, HOOK_ENTRY, SETTINGS_PATH };

if (require.main === module) {
  install();
}
