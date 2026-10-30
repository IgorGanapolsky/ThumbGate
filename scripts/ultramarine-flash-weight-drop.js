'use strict';

// Paper Instruments mailed on 2026-10-30 that Ultramarine 1 Flash weights are on
// Hugging Face, that the existing API keeps working, and that Fireworks and
// Baseten will also offer the model. The public card
// (https://huggingface.co/paperinstruments/Ultramarine-1-Flash) says 320B total
// parameters, 18B active, and a 1,048,576-token context. The same page says no
// Inference Provider is serving it, and the published serve command uses
// 262,144 tokens. Those numbers are the vendor card. They are not a ThumbGate
// model, route, or context window.
//
// Compaction from that card: 85% of the window, or 30,000 tokens left,
// whichever comes first. Weight files, Paper Office, and feather-train stay
// off this repo.

const GATE = 'ultramarine-flash-weight-drop';

const VENDOR_CARD = Object.freeze({
  sourceUrl: 'https://huggingface.co/paperinstruments/Ultramarine-1-Flash',
  repoId: 'paperinstruments/Ultramarine-1-Flash',
  totalParametersBillions: 320,
  activeParametersBillions: 18,
  contextTokens: 1048576,
  publishedServeContextTokens: 262144,
  compactionFraction: 0.85,
  compactionRemainingTokens: 30000,
  partnersNamedInMail: Object.freeze(['fireworks', 'baseten']),
  inferenceProvidersLiveOnCard: false,
});

const BENIGN = new Set([
  'echo', 'printf', 'rg', 'grep', 'ag', 'ack', 'cat', 'head', 'tail', 'less', 'more', 'wc',
]);

const EDIT_TOOLS = new Set([
  'edit', 'write', 'search_replace', 'multiedit', 'strreplace', 'str_replace',
]);

const WEIGHT_RES = [
  /\b(?:huggingface-cli|hf)\s+(?:download|repo\s+download)\b[\s\S]{0,240}paperinstruments\/Ultramarine-1-Flash/i,
  /\b(?:wget|curl)\b[\s\S]{0,300}huggingface\.co\/paperinstruments\/Ultramarine-1-Flash\/resolve\b/i,
  /\bgit\s+clone\b[\s\S]{0,240}(?:paper-instruments\/feather-train|feather-train\.git)/i,
  /\b(?:pip3?|uv\s+pip|npm|pnpm|yarn)\s+install\b[\s\S]{0,180}\bpaper-(?:docx|pptx|xlsx)\b/i,
  /\bsglang(?:\.launch_server)?\b[\s\S]{0,280}paperinstruments\/Ultramarine-1-Flash/i,
];

const ROUTE_RE = /\b(?:baseUrl|base_url|modelEndpoint|inferenceProvider|THUMBGATE_MODEL_BASE)\b[\s\S]{0,120}\b(?:api\.paperinstruments\.com|(?:api\.)?fireworks\.ai|(?:api\.)?baseten\.co)\b/i;

const CONTEXT_RE = /\b(?:contextWindow(?:Tokens)?|context_window|maxWindowTokens|context-length)\b[\s\S]{0,48}\b(?:1048576|1000000)\b/i;

const TOTAL_COST_RE = /\b(?:costBasis|costPer|pricePer|parameterCost)\b[\s\S]{0,48}\b320\b/i;

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
  return String(text || '').replace(/'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|`(?:\\.|[^`])*`/g, '""');
}

function refusalProse(line) {
  return /\b(?:do not|don't|does not|doesn't|never|must not)\b/i.test(withoutQuotes(line));
}

function actionable(text) {
  return stripComments(String(text || ''))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !refusalProse(line))
    .join('\n');
}

function firstBin(command) {
  const word = String(command || '').trim().split(/\s+/)[0] || '';
  return word.split('/').pop();
}

function splitSegments(text) {
  const parts = [];
  let out = '';
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === '\\' && quote !== "'") {
        out += text[i + 1] || '';
        i += 1;
      } else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === '&&' || two === '||' || c === ';' || c === '|' || c === '\n') {
      if (out.trim()) parts.push(out.trim());
      out = '';
      if (two === '&&' || two === '||') i += 1;
      continue;
    }
    out += c;
  }
  if (out.trim()) parts.push(out.trim());
  return parts;
}

function substitutions(segment) {
  const found = [];
  const pattern = /\$\(([^()]*)\)|`([^`]*)`/g;
  let match = pattern.exec(segment);
  while (match) {
    found.push(match[1] || match[2] || '');
    match = pattern.exec(segment);
  }
  return found;
}

function weightCommand(command, depth = 0) {
  if (!command || depth > 4) return false;
  const segments = splitSegments(stripComments(command));
  for (const segment of segments) {
    for (const nested of substitutions(segment)) {
      if (weightCommand(nested, depth + 1)) return true;
    }
    const visible = segment.replace(/\$\([^()]*\)|`[^`]*`/g, ' ');
    if (BENIGN.has(firstBin(visible))) continue;
    if (weightHit(visible)) return true;
  }
  return false;
}

function editedPath(source) {
  if (!source || typeof source !== 'object') return '';
  return source.file_path || source.path || source.filePath || '';
}

function collectedText(view) {
  const input = view.toolInput || {};
  const parts = [view.command, input.command, input.cmd, input.new_string, input.newString, input.contents, input.content];
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

function ownFile(paths) {
  return paths.length > 0 && paths.every((filePath) => (
    /ultramarine-flash-weight-drop(?:\.test)?\.js$/.test(String(filePath).replace(/\\/g, '/'))
  ));
}

function mentionsModel(text) {
  return /ultramarine|paperinstruments/i.test(text);
}

function weightHit(text) {
  return WEIGHT_RES.find((pattern) => pattern.test(text)) || null;
}

function compactionDue({ windowTokens, usedTokens } = {}) {
  const window = Number(windowTokens);
  const used = Number(usedTokens);
  if (!Number.isFinite(window) || window <= 0 || !Number.isFinite(used) || used < 0) {
    return { due: false, reason: 'missing-window' };
  }
  const remaining = window - used;
  const fraction = used / window;
  const fractionHit = fraction >= VENDOR_CARD.compactionFraction;
  const remainingHit = window > VENDOR_CARD.compactionRemainingTokens
    && remaining <= VENDOR_CARD.compactionRemainingTokens;
  if (fractionHit && (!remainingHit || fraction * window <= window - VENDOR_CARD.compactionRemainingTokens)) {
    return { due: true, reason: 'fraction', fraction, remaining };
  }
  if (remainingHit) return { due: true, reason: 'remaining', fraction, remaining };
  return { due: false, reason: 'under-both', fraction, remaining };
}

function meterMoeCostBasis(card = VENDOR_CARD) {
  const total = Number(card.totalParametersBillions);
  const active = Number(card.activeParametersBillions);
  return {
    vendorClaim: true,
    sourceUrl: card.sourceUrl,
    costBasis: 'active_parameters',
    activeParametersBillions: active,
    totalParametersBillions: total,
    adoptedAsThumbGateModel: false,
    adoptedAsThumbGateContextWindow: false,
    inferenceProvidersLiveOnCard: false,
  };
}

function evaluateUltramarineFlashWeightDrop(view = {}) {
  const paths = touchedPaths(view);
  if (ownFile(paths)) return null;
  const raw = collectedText(view);
  const text = actionable(raw);
  if (!text.trim()) return null;

  const tool = String(view.toolName || '').toLowerCase();
  const editing = EDIT_TOOLS.has(tool);
  const command = view.command || (view.toolInput && view.toolInput.command) || '';

  if (!editing && weightCommand(command)) {
    return deny(
      'weight_vendor_refused',
      'Denied: Ultramarine 1 Flash weights, Paper Office, and feather-train stay off ThumbGate. The Hugging Face card is a vendor publish, not a model we download or serve.',
    );
  }

  if (editing && weightHit(text)) {
    return deny(
      'weight_vendor_refused',
      'Denied: Ultramarine 1 Flash weights, Paper Office, and feather-train stay off ThumbGate. The Hugging Face card is a vendor publish, not a model we download or serve.',
    );
  }

  if (!editing) return null;
  if (!mentionsModel(raw)) return null;

  if (ROUTE_RE.test(text)) {
    return deny(
      'partner_is_not_a_route',
      'Denied: the mail names Fireworks and Baseten, and the model card says no Inference Provider is serving Ultramarine 1 Flash. That does not set a ThumbGate route.',
    );
  }
  if (CONTEXT_RE.test(text)) {
    return deny(
      'vendor_context_not_adopted',
      'Denied: the vendor card\'s 1,048,576-token context is not ThumbGate\'s context window. The published serve command uses 262,144.',
    );
  }
  if (TOTAL_COST_RE.test(text) && !/\bactive\b/i.test(text)) {
    return deny(
      'cost_uses_active_slice',
      'Denied: a mixture-of-experts cost uses the active parameter slice from the vendor card, not the 320B headline total.',
    );
  }
  return null;
}

module.exports = {
  GATE,
  VENDOR_CARD,
  compactionDue,
  meterMoeCostBasis,
  evaluateUltramarineFlashWeightDrop,
};
