#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CHAR_LIMIT = 2200;
const PROFILE_FILENAME = 'USER_PROFILE.md';

function getProfilePath() {
  if (process.env.RLHF_FEEDBACK_DIR) {
    return path.join(process.env.RLHF_FEEDBACK_DIR, PROFILE_FILENAME);
  }
  const localRlhf = path.join(process.cwd(), '.rlhf');
  if (fs.existsSync(localRlhf)) {
    return path.join(localRlhf, PROFILE_FILENAME);
  }
  return path.join(os.homedir(), '.rlhf', PROFILE_FILENAME);
}

function loadProfile() {
  const profilePath = getProfilePath();
  if (!fs.existsSync(profilePath)) return { entries: [], charCount: 0 };
  const content = fs.readFileSync(profilePath, 'utf8');
  const entries = content.split('\n§\n').filter(Boolean).map(e => e.trim());
  const charCount = entries.join('\n§\n').length;
  return { entries, charCount, path: profilePath };
}

function saveProfile(entries) {
  const profilePath = getProfilePath();
  const dir = path.dirname(profilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(profilePath, entries.join('\n§\n') + '\n', 'utf8');
}

function addEntry(content) {
  const { entries, charCount } = loadProfile();
  const newCharCount = charCount + content.length + 3; // +3 for \n§\n
  if (newCharCount > CHAR_LIMIT) {
    return { success: false, error: `Profile at ${charCount}/${CHAR_LIMIT} chars. Adding ${content.length} chars would exceed limit. Remove or replace entries first.`, entries, usage: `${charCount}/${CHAR_LIMIT}` };
  }
  // Dedup
  if (entries.some(e => e === content)) {
    return { success: true, message: 'Entry already exists (no duplicate added)', entries };
  }
  entries.push(content);
  saveProfile(entries);
  return { success: true, entries, usage: `${charCount + content.length}/${CHAR_LIMIT}` };
}

function removeEntry(substring) {
  const { entries } = loadProfile();
  const idx = entries.findIndex(e => e.includes(substring));
  if (idx === -1) return { success: false, error: `No entry matching "${substring}"` };
  entries.splice(idx, 1);
  saveProfile(entries);
  return { success: true, entries };
}

function replaceEntry(oldSubstring, newContent) {
  const { entries } = loadProfile();
  const idx = entries.findIndex(e => e.includes(oldSubstring));
  if (idx === -1) return { success: false, error: `No entry matching "${oldSubstring}"` };
  entries[idx] = newContent;
  saveProfile(entries);
  return { success: true, entries };
}

function renderForSystemPrompt() {
  const { entries, charCount } = loadProfile();
  if (entries.length === 0) return '';
  const pct = Math.round((charCount / CHAR_LIMIT) * 100);
  return `══════════════════════════════════════════════\n USER PROFILE [${pct}% — ${charCount}/${CHAR_LIMIT} chars]\n══════════════════════════════════════════════\n${entries.join('\n§\n')}`;
}

module.exports = { loadProfile, addEntry, removeEntry, replaceEntry, renderForSystemPrompt, CHAR_LIMIT };
