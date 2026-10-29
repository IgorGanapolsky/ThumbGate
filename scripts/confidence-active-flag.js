'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { evaluateConfidenceAction } = require('./spotify-confidence-diode');

const GATE = 'confidence-active-flag';
const MAX_EDIT_FILE_BYTES = 1024 * 1024;
const EDIT_TOOLS = new Set(['edit', 'write', 'search_replace', 'multiedit', 'strreplace']);
const WRAPPERS = new Set(['sudo', 'command', 'exec', 'nohup', 'nice', 'time', 'env']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ash']);
const BENIGN = new Set(['rg', 'grep', 'ag', 'ack', 'ggrep', 'echo', 'printf', 'true', 'false', 'cat']);
const MANAGED = /^(?:ROLLOUT|AB_TEST|A_B_TEST|ABTEST)$/i;

function deny(failureReason, message) {
  return {
    decision: 'deny',
    gate: GATE,
    severity: 'critical',
    failureReason,
    message,
  };
}

function stripComments(text) {
  let out = '';
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      out += c;
      if (c === '\\' && quote !== "'") {
        out += next || '';
        i += 1;
      } else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    if (c === '#' && (i === 0 || /[\s;&|()]/.test(text[i - 1]))) {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

function balanced(text, start, open, close) {
  if (text[start] !== open) return '';
  let depth = 0;
  let quote = '';
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '\\' && quote !== "'") {
        i += 1;
        continue;
      }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"') {
      quote = '"';
      continue;
    }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

function shellWords(part) {
  const words = [];
  let current = '';
  let quote = '';
  for (let i = 0; i < part.length; i += 1) {
    const c = part[i];
    if (quote) {
      if (c === '\\' && quote !== "'") {
        current += part[i + 1] || '';
        i += 1;
        continue;
      }
      if (c === quote) quote = '';
      else current += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (current) words.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  if (current) words.push(current);
  return words;
}

function splitTopLevel(command) {
  const parts = [];
  let quote = '';
  let start = 0;
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (quote) {
      if (c === '\\' && quote !== "'") {
        i += 1;
        continue;
      }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '#' && (i === 0 || /[\s;&|()]/.test(command[i - 1]))) {
      parts.push(command.slice(start, i));
      while (i < command.length && command[i] !== '\n') i += 1;
      start = i + 1;
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      parts.push(command.slice(start, i));
      i += 1;
      start = i + 1;
      continue;
    }
    if (c === ';' || c === '\n' || c === '|') {
      parts.push(command.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(command.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function commandWords(part) {
  const words = shellWords(part);
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i += 1;
  while (i < words.length) {
    const base = words[i].split('/').pop();
    if (!WRAPPERS.has(base)) break;
    i += 1;
    if (base === 'sudo') {
      while (i < words.length && words[i].startsWith('-')) {
        const flag = words[i];
        i += 1;
        if (flag === '-u' || flag === '--user') i += 1;
      }
    } else if (base === 'env' || base === 'command' || base === 'nice' || base === 'time') {
      while (i < words.length && words[i].startsWith('-')) i += 1;
    }
  }
  return words.slice(i);
}

function isConfidenceCommand(part) {
  const words = commandWords(part);
  if (!words.length) return false;
  const bin = words[0].split('/').pop();
  if (BENIGN.has(bin)) return false;
  if (bin === 'confidence') return true;
  if (bin === 'npx' || bin === 'npm') {
    return words.some((word) => word.includes('@spotify-confidence'));
  }
  return words[0].includes('@spotify-confidence');
}

function flagArgument(words, name) {
  const index = words.findIndex((word) => word === name);
  return index >= 0 ? words[index + 1] || '' : '';
}

function heredocBodies(command) {
  const bodies = [];
  const re = /<<-?\s*(?:'([^']+)'|"([^"]+)"|\\?(\w+))/g;
  let match = re.exec(command);
  while (match) {
    const delim = match[1] || match[2] || match[3];
    const rest = command.slice(match.index + match[0].length);
    const end = rest.search(new RegExp(`(?:^|\\n)${delim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:\\n|$)`));
    if (end >= 0) bodies.push(rest.slice(0, end));
    match = re.exec(command);
  }
  return bodies;
}

function commandBodies(command) {
  const bodies = heredocBodies(command);
  for (const part of splitTopLevel(command)) {
    const words = commandWords(part);
    const bin = words.length ? words[0].split('/').pop() : '';
    if (BENIGN.has(bin)) continue;
    if (SHELLS.has(bin)) {
      const script = flagArgument(words, '-c') || flagArgument(words, '-lc');
      if (script) bodies.push(script);
      continue;
    }
    if (bin === 'node' || bin === 'python' || bin === 'python3') {
      const code = flagArgument(words, '-e') || flagArgument(words, '-c');
      if (code) bodies.push(code);
      continue;
    }
    if (isConfidenceCommand(part)) bodies.push(part);
  }
  return bodies;
}

function editsOf(toolInput) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const many = Array.isArray(input.edits) ? input.edits : [input];
  return many.map((edit) => ({
    text: String(edit.new_string ?? edit.newString ?? edit.contents ?? edit.content ?? ''),
    oldText: String(edit.old_string ?? edit.oldString ?? ''),
    filePath: String(edit.file_path ?? edit.filePath ?? edit.path ?? input.file_path ?? input.filePath ?? input.path ?? ''),
    replaceAll: Boolean(edit.replace_all ?? edit.replaceAll ?? input.replace_all ?? input.replaceAll),
  })).filter((edit) => edit.text);
}

function readOriginal(filePath) {
  if (!filePath) return null;
  try {
    const resolved = path.resolve(filePath);
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > MAX_EDIT_FILE_BYTES) return null;
    return fs.readFileSync(resolved, 'utf8');
  } catch (_) {
    return null;
  }
}

function propose(original, oldText, newText, replaceAll) {
  if (!original || !oldText || !original.includes(oldText)) return null;
  const parts = original.split(oldText);
  const count = parts.length - 1;
  if (count > 1 && !replaceAll) return null;
  if (replaceAll) return parts.join(newText);
  return original.replace(oldText, newText);
}

function patternCount(text, expression) {
  return (String(text || '').match(expression) || []).length;
}

function failOpenCount(text, filePath) {
  let count = patternCount(text, /getBooleanFlag\s*\(\s*(['"])[^'"]+\1\s*,\s*true\s*\)/g);
  count += patternCount(text, /resolveFlag\s*\(\s*(['"])[^'"]+\1\s*,\s*true\s*\)/g);
  count += patternCount(text, /resolveFlag\s*\(\s*(['"])[^'"]+\1\s*,\s*(['"])enabled\2\s*\)/g);
  const confidenceContext = /"state"\s*:\s*"ACTIVE"/.test(text)
    || /confidence/i.test(filePath)
    || /[/\\]flags[/\\]/i.test(filePath);
  if (confidenceContext) count += patternCount(text, /"defaultValue"\s*:\s*true\b/g);
  return count;
}

function isBadKey(key) {
  const bare = String(key || '').split('/').pop();
  if (/(?:^|-)(?:enabled|disabled)$/i.test(bare)) return true;
  return /^[A-Z][A-Z0-9]+-\d+$/.test(bare);
}

function badFlagKeys(text) {
  const keys = [];
  for (const match of String(text || '').matchAll(/\bflags?\s+create\s+([A-Za-z0-9_.:/-]+)/g)) {
    if (isBadKey(match[1])) keys.push(match[1]);
  }
  for (const match of String(text || '').matchAll(/"(?:flagKey|flag_key)"\s*:\s*"([^"]+)"/g)) {
    if (isBadKey(match[1])) keys.push(match[1]);
  }
  return keys;
}

function rulePercent(rule) {
  const spec = rule.assignmentSpec && typeof rule.assignmentSpec === 'object' ? rule.assignmentSpec : {};
  const candidates = [rule.percent, rule.percentage, rule.allocation, rule.reach, spec.percent, spec.percentage, spec.allocation];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function isMatchAll(rule) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return false;
  if (Array.isArray(rule.userIds) && rule.userIds.length) return false;
  if (Array.isArray(rule.values) && rule.values.length) return false;
  if (Array.isArray(rule.targets) && rule.targets.length) return false;
  const conditions = rule.conditions || rule.condition;
  if (Array.isArray(conditions) && conditions.length) return false;
  if (conditions && typeof conditions === 'object' && !Array.isArray(conditions) && Object.keys(conditions).length) return false;
  const segment = String(rule.segment ?? rule.audience ?? '').trim().toLowerCase();
  if (segment && segment !== '*' && segment !== 'all' && segment !== 'everyone') return false;
  const percent = rulePercent(rule);
  return !(percent !== null && percent < 100);
}

function catchAllBeforeSubset(rules) {
  let seenMatchAll = false;
  for (const rule of rules) {
    if (isMatchAll(rule)) seenMatchAll = true;
    else if (seenMatchAll) return true;
  }
  return false;
}

function extractRules(text) {
  const marker = text.search(/"rules"\s*:/);
  if (marker < 0) return null;
  const start = text.indexOf('[', marker);
  if (start < 0) return null;
  const slice = balanced(text, start, '[', ']');
  if (!slice) return null;
  try {
    const value = JSON.parse(slice);
    return Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function fragmentRules(text) {
  const found = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '{') continue;
    const slice = balanced(text, i, '{', '}');
    if (!slice || (!slice.includes('managedBy') && !slice.includes('managed_by'))) continue;
    try {
      const value = JSON.parse(slice);
      if (value && typeof value === 'object' && (value.managedBy || value.managed_by)) found.push(value);
    } catch (_) {
      // The next brace may still be a complete rule.
    }
  }
  return found;
}

function managedCanon(text) {
  if (!/"managedBy"|"managed_by"/.test(text)) return '';
  const fromRules = extractRules(text);
  const list = Array.isArray(fromRules) ? fromRules : fragmentRules(text);
  return list
    .filter((rule) => rule && MANAGED.test(String(rule.managedBy || rule.managed_by || '')))
    .map((rule) => JSON.stringify(rule.assignmentSpec ?? null))
    .sort((left, right) => left.localeCompare(right))
    .join('|');
}

function explicitRolloutPercent(command) {
  let highest = null;
  for (const part of splitTopLevel(command).filter(isConfidenceCommand)) {
    const match = part.match(/(?:--percent(?:=|\s+)|--rollout(?:=|\s+)|set\s+)(\d{1,3})\b/);
    if (!match) continue;
    const value = Number(match[1]);
    if (highest === null || value > highest) highest = value;
  }
  return highest;
}

function judge(body) {
  const text = stripComments(String(body.text || ''));
  const oldText = stripComments(String(body.oldText || ''));
  const filePath = String(body.filePath || '');
  if (failOpenCount(text, filePath) > failOpenCount(oldText, filePath)) {
    return deny(
      'fail_open_default',
      'Denied a client fallback of enabled. When no rule matches, the client uses its compiled default, so the feature would be on.'
    );
  }
  const keys = badFlagKeys(text);
  if (keys.length > badFlagKeys(oldText).length) {
    return deny(
      'config_in_flag_key',
      `Denied flag key '${keys[0]}'. The key is permanent in code. Use a behavior name such as new-navbar.`
    );
  }
  const rules = extractRules(text);
  const previousRules = extractRules(oldText);
  if (rules && catchAllBeforeSubset(rules) && !(previousRules && catchAllBeforeSubset(previousRules))) {
    return deny(
      'catch_all_before_subset',
      'Denied a rule that matches every user above a narrower rule. The first match wins, so the later rule never runs.'
    );
  }
  const nextSpec = managedCanon(text);
  const prevSpec = managedCanon(oldText);
  if (nextSpec && nextSpec !== prevSpec) {
    return deny(
      'managed_rule_rewrite',
      'Denied a hand edit of a rollout or A/B assignment. Change those from the rollout, not by rewriting the rules list.'
    );
  }
  return null;
}

function evaluateConfidenceActiveFlag(view = {}) {
  const tool = String(view.toolName || '').toLowerCase();
  const toolInput = view.toolInput && typeof view.toolInput === 'object' ? view.toolInput : {};
  const command = String(view.command || toolInput.command || toolInput.cmd || '');
  const bodies = [];
  if (EDIT_TOOLS.has(tool)) bodies.push(...editsOf(toolInput));
  if (command) {
    for (const source of [command, ...commandBodies(command)]) {
      const rollout = explicitRolloutPercent(source);
      if (rollout === null) continue;
      const diode = evaluateConfidenceAction({
        tool: 'set_rollout',
        flag: 'flag',
        rolloutPercent: rollout,
      });
      if (diode.decision === 'block') return deny('rollout_ceiling', diode.reason);
    }
    for (const text of commandBodies(command)) bodies.push({ text, oldText: '', filePath: '' });
  }
  for (const body of bodies) {
    const original = readOriginal(body.filePath);
    const proposed = propose(original, body.oldText, body.text, body.replaceAll);
    let judged = body;
    if (proposed != null) judged = { text: proposed, oldText: original, filePath: body.filePath };
    else if (!body.oldText && original) judged = { ...body, oldText: original };
    const result = judge(judged);
    if (result) return result;
  }
  return null;
}

module.exports = {
  GATE,
  evaluateConfidenceActiveFlag,
};
