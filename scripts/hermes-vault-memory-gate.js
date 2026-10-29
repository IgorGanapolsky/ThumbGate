'use strict';

// Hermes Agent documents three separate facts this gate enforces:
// - Two processes on one Hermes home compound each other's memory.
//   https://hermes-agent.nousresearch.com/docs/user-guide/profiles
// - MEMORY.md and USER.md are frozen snapshots with their own character caps.
//   A write past the cap is an error. A duplicate entry is rejected.
//   https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
// - File tools need a resolved vault path, not $OBSIDIAN_VAULT_PATH.
//   https://hermes-agent.nousresearch.com/docs/user-guide/skills/bundled/note-taking/note-taking-obsidian
// The caps are Hermes's limits for those two files. They are not ThumbGate measurements.

const SOURCE = 'hermes-obsidian-vault-2026-10-29';

const PROFILE_CHAR_CAP = Object.freeze({
  'MEMORY.md': 2200,
  'USER.md': 1375,
});

const UNRESOLVED_VAULT_RE = /\$\{?OBSIDIAN_VAULT_PATH\}?/;
const FILE_TOOL_RE = /\b(?:read_file|write_file|search_files)\b/;
const SHARES_HOME_RE = /\b(?:shared brain|shared memory|both agents|second (?:agent|writer)|two (?:agents|writers))\b/i;
const FROZEN_CLAIM_RE = /\b(?:already (?:sees|knows) (?:this|it)|same session will see|other agent (?:now|already) sees)\b/i;
const CONTENT_PLAN_RE = /\b(?:content plan|content calendar|video script|reel script)\b/i;
const SECRET_RE = /\b(?:sk_live_[A-Za-z0-9]+|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----)\b/;
const INJECTION_RE = /\bignore (?:all )?(?:previous|prior) instructions\b/i;
const INVISIBLE_RE = /[\u200B\u200C\u200D\u2060\uFEFF]/;

function isWriteTool(toolName) {
  return /write|edit|bash|shell|exec|notebook|multiedit|apply_patch/i.test(String(toolName || ''));
}

function destinationText(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  if (!toolInput || typeof toolInput !== 'object') return '';
  const keys = ['command', 'cmd', 'path', 'file_path', 'target_file', 'profileFile', 'target'];
  return keys.map((key) => (toolInput[key] == null ? '' : String(toolInput[key]))).join('\n');
}

function profileName(dest) {
  if (!/(?:~\/\.hermes|\$\{?HERMES_HOME\}?)/i.test(dest)) return null;
  const match = dest.match(/memories\/(MEMORY|USER)\.md\b/i);
  if (!match) return null;
  const name = `${match[1].toUpperCase()}.md`;
  return Object.prototype.hasOwnProperty.call(PROFILE_CHAR_CAP, name) ? name : null;
}

function bodyForMemoryDest(toolInput, dest) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  const memoryDest = profileName(dest) || /obsidian|\/vault\//i.test(dest);
  if (!memoryDest) return '';
  return ['body', 'content', 'new_string', 'entry']
    .map((key) => (typeof toolInput[key] === 'string' ? toolInput[key] : ''))
    .filter(Boolean)
    .join('\n');
}

function sharesOneHome(dest) {
  if (SHARES_HOME_RE.test(dest)) return true;
  return /\bjarvis\b/i.test(dest) && /\bhermes\b/i.test(dest);
}

function hasSourceNote(toolInput, dest) {
  if (toolInput && typeof toolInput.sourceNote === 'string') {
    const note = toolInput.sourceNote.trim();
    if (/\.md$/i.test(note) && !/(?:^|\/)(?:MEMORY|USER|SOUL)\.md$/i.test(note)) return true;
  }
  const marked = dest.match(/\b(?:from|source|based on|note)\b[:\s]+["']?((?:\/|\.\/|~\/)[^"'`\n]+\.md)/i);
  if (!marked) return false;
  return !/(?:^|\/)(?:MEMORY|USER|SOUL)\.md$/i.test(marked[1]);
}

function evaluateSharedVaultMemoryPretool({ toolName, toolInput } = {}) {
  const blockers = [];
  if (!isWriteTool(toolName)) {
    return { ok: true, blockers, source: SOURCE };
  }

  const dest = destinationText(toolInput);
  const body = bodyForMemoryDest(toolInput, dest);
  const profile = profileName(dest);
  const hermesProfileWrite = Boolean(profile);

  if (hermesProfileWrite && sharesOneHome(dest)) {
    blockers.push('hermes_home_is_not_the_shared_vault');
  }
  if (hermesProfileWrite && FROZEN_CLAIM_RE.test(`${dest}\n${body}`)) {
    blockers.push('profile_write_is_frozen_until_next_session');
  }
  if (UNRESOLVED_VAULT_RE.test(dest)) {
    const resolvingOnly = /^\s*(?:printenv|echo)\b/.test(dest.trim()) && !FILE_TOOL_RE.test(dest);
    if (!resolvingOnly) blockers.push('unresolved_vault_path');
  }

  const profileBody = profile
    ? (typeof toolInput?.body === 'string' ? toolInput.body : (typeof toolInput?.content === 'string' ? toolInput.content : null))
    : null;
  if (profile && profileBody != null && profileBody.length > PROFILE_CHAR_CAP[profile]) {
    blockers.push('profile_memory_over_cap');
  }
  if (profile && typeof toolInput?.entry === 'string' && Array.isArray(toolInput.existingEntries)
    && toolInput.existingEntries.includes(toolInput.entry)) {
    blockers.push('duplicate_memory_entry');
  }
  if ((SECRET_RE.test(body) || INJECTION_RE.test(body) || INVISIBLE_RE.test(body))
    && (hermesProfileWrite || /obsidian|\/vault\//i.test(dest))) {
    blockers.push('memory_entry_unsafe');
  }

  const planning = CONTENT_PLAN_RE.test(`${dest}\n${body}`) && /obsidian|\/vault\/|shared memory|second brain/i.test(`${dest}\n${body}`);
  if (planning && !hasSourceNote(toolInput, dest)) {
    blockers.push('content_plan_without_note');
  }

  const vaultWrite = /obsidian|\/vault\//i.test(dest) && /\.md\b/i.test(dest);
  if (vaultWrite && /\btype:\s*memory\b/i.test(body) && !/\b(?:agent|author):\s*\S+/.test(body)) {
    blockers.push('vault_memory_missing_author');
  }

  return { ok: blockers.length === 0, blockers, source: SOURCE };
}

module.exports = {
  PROFILE_CHAR_CAP,
  SOURCE,
  evaluateSharedVaultMemoryPretool,
};
