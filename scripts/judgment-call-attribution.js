'use strict';

// Anthropic's note "How AI agents shape experts' judgment calls"
// (https://www.anthropic.com/research/agents-judgment-calls) describes a hidden
// lean: the person later repeats the agent's argument and calls the result
// their own. The study's rates stay the study's. This gate checks the decision
// record ThumbGate is about to write.
//
// A decision record names who leaned and names the other option. A sign-off is
// not an independent decision unless the person's own view was written first,
// or the call is explicitly deferred.

const GATE = 'judgment-call-attribution';
const SOURCE_URL = 'https://www.anthropic.com/research/agents-judgment-calls';

const EDIT_TOOLS = new Set([
  'edit', 'write', 'search_replace', 'multiedit', 'strreplace', 'str_replace',
]);
const READ_TOOLS = new Set(['read', 'grep', 'glob', 'search']);
const BENIGN = new Set([
  'echo', 'printf', 'rg', 'grep', 'ag', 'ack', 'cat', 'head', 'tail', 'less', 'more', 'wc',
]);

const SURFACE_RE = /(?:^|\/)(?:decisions\.md|sow-latest\.json|shared_facts(?:\.json)?)$|(?:^|\/)\.herd-swarm\//;
const FACT_RE = /\bshared_facts\b/;
const DECISION_RE = /\b(?:recommend(?:ation)?|i decided|my own judgment|signed off|sign-off|decision_attribution)\b/i;
const SOURCE_RE = /\b(?:source_agent|credited_to)\b/;
const OTHER_RE = /\b(?:other_option|the other option|both options)\b/i;
const OWN_RE = /\b(?:my own judgment|independently decided|human sign-off|signed off)\b/i;
const PRIOR_RE = /\b(?:human_view_first|deferred)\b/;

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
    if (quote) {
      out += c;
      if (c === '\\' && quote !== "'") {
        out += text[i + 1] || '';
        i += 1;
        continue;
      }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      continue;
    }
    const hashComment = c === '#' && (i === 0 || /[\s;&|()]/.test(text[i - 1]));
    const slashComment = c === '/' && text[i + 1] === '/' && (i === 0 || /[\s;|&(=]/.test(text[i - 1]));
    if (hashComment || slashComment) {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    out += c;
  }
  return out;
}

function withoutQuotes(text) {
  const source = String(text || '');
  let out = '';
  let quote = '';
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
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
      out += '""';
      continue;
    }
    out += c;
  }
  return out;
}

function actionable(text) {
  return stripComments(String(text || ''))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/\b(?:do not|don't|does not|doesn't|never|must not)\b/i.test(withoutQuotes(line)))
    .join('\n');
}

function editedPath(source) {
  if (!source || typeof source !== 'object') return '';
  return source.file_path || source.path || source.filePath || '';
}

function collectedText(view) {
  const input = view.toolInput || {};
  const parts = [
    view.command, input.command, input.cmd,
    input.new_string, input.newString, input.contents, input.content,
  ];
  if (Array.isArray(input.edits)) {
    for (const edit of input.edits) {
      parts.push(edit.new_string, edit.newString, edit.contents, edit.content);
    }
  }
  return parts.filter((part) => typeof part === 'string').join('\n');
}

function touchedPaths(view) {
  const input = view.toolInput || {};
  const paths = [editedPath(input)];
  if (Array.isArray(input.edits)) {
    for (const edit of input.edits) paths.push(editedPath(edit));
  }
  return paths.filter(Boolean);
}

function isDecisionSurface(filePath) {
  return SURFACE_RE.test(String(filePath || '').replace(/\\/g, '/'));
}

function ownFile(paths) {
  return paths.length > 0 && paths.every((filePath) => (
    /judgment-call-attribution(?:\.test)?\.js$/.test(String(filePath).replace(/\\/g, '/'))
  ));
}

function targetsSurface(command) {
  return /(?:>>?|\btee\b)\s+\S*(?:decisions\.md|sow-latest\.json|shared_facts(?:\.json)?|\.herd-swarm\/)/.test(String(command || ''));
}

function writesSurface(view) {
  const tool = String(view.toolName || '').toLowerCase();
  if (READ_TOOLS.has(tool)) return false;
  if (EDIT_TOOLS.has(tool)) return touchedPaths(view).some(isDecisionSurface);
  const command = view.command || (view.toolInput && (view.toolInput.command || view.toolInput.cmd)) || '';
  if (!command || !targetsSurface(command)) return false;
  const bin = String(command).trim().split(/\s+/)[0].split('/').pop();
  if (BENIGN.has(bin) && !/(?:>>?|\btee\b)/.test(command)) return false;
  return true;
}

function evaluateJudgmentCallAttribution(view = {}) {
  const paths = touchedPaths(view);
  if (ownFile(paths)) return null;
  if (!writesSurface(view)) return null;
  const text = actionable(collectedText(view));
  if (!text.trim()) return null;

  const recordingFact = FACT_RE.test(text);
  const recordingDecision = DECISION_RE.test(text);
  if (!recordingFact && !recordingDecision) return null;

  if (!SOURCE_RE.test(text)) {
    return deny(
      'lean_not_named',
      'Denied: a judgment call has to name the agent who leaned. Write source_agent or credited_to on the decision record.',
    );
  }
  if (recordingDecision && !OTHER_RE.test(text)) {
    return deny(
      'other_option_missing',
      'Denied: a judgment call has to name the other option, not only the one the agent argued.',
    );
  }
  if (OWN_RE.test(text) && !PRIOR_RE.test(text)) {
    return deny(
      'signoff_is_not_independence',
      'Denied: a sign-off is not the person\'s own judgment unless their view was written first (human_view_first) or the call is explicitly deferred.',
    );
  }
  return null;
}

module.exports = {
  GATE,
  SOURCE_URL,
  adoptedStudyRates: false,
  evaluateJudgmentCallAttribution,
};
