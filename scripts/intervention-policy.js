#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');
const { getDecisionLogPath, readDecisionLog, collapseDecisionTimeline } = require('./decision-journal');

const LABELS = ['allow', 'recall', 'verify', 'warn', 'deny'];
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HOLDOUT_RATIO = 0.2;
const MIN_HOLDOUT_EXAMPLES = 5;
const MIN_TRAINING_EXAMPLES = 8;
const MAX_TEXT_TOKENS = 24;
const MODEL_FILENAME = 'intervention-policy.json';

const SURFACE_RULES = [
  { key: 'policy', pattern: /^(?:AGENTS\.md|CLAUDE(?:\.local)?\.md|GEMINI\.md|config\/gates\/|config\/mcp-allowlists\.json|scripts\/tool-registry\.js)/i },
  { key: 'release', pattern: /^(?:package\.json|package-lock\.json|server\.json|\.github\/workflows\/|scripts\/publish-decision\.js|scripts\/pr-manager\.js)/i },
  { key: 'runtime', pattern: /^(?:scripts\/|src\/api\/|adapters\/mcp\/)/i },
  { key: 'tests', pattern: /^(?:tests\/|proof\/)/i },
  { key: 'docs', pattern: /^(?:docs\/|README\.md|CHANGELOG\.md|WORKFLOW\.md)/i },
  { key: 'public', pattern: /^(?:public\/|\.well-known\/)/i },
];

const TEXT_STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'had',
  'were', 'been', 'into', 'your', 'their', 'about', 'after', 'before', 'while',
  'then', 'than', 'just', 'very', 'more', 'when', 'what', 'which', 'would',
  'could', 'should', 'again', 'same', 'tool', 'action', 'agent', 'workflow',
  'thumbs', 'positive', 'negative', 'signal', 'recorded',
]);

function modelPathFor(feedbackDir) {
  return path.join(resolveFeedbackDir({ feedbackDir }), MODEL_FILENAME);
}

function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function safeRate(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\/users\/[^\s/]+/g, '/users/redacted')
    .replace(/[^a-z0-9/_-]+/g, ' ')
    .trim();
}

function tokenizeText(value, limit = MAX_TEXT_TOKENS) {
  if (!value) return [];
  const tokens = normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !TEXT_STOPWORDS.has(token));
  return [...new Set(tokens)].slice(0, limit);
}

function pushToken(tokens, token) {
  const normalized = normalizeText(token);
  if (!normalized) return;
  tokens.add(normalized.replace(/\s+/g, '_'));
}

function pushTextTokens(tokens, prefix, value, limit = 6) {
  for (const token of tokenizeText(value, limit)) {
    pushToken(tokens, `${prefix}:${token}`);
  }
}

function normalizeSignal(value) {
  const text = normalizeText(value);
  if (['up', 'positive', 'thumbsup', 'thumbs_up', 'thumbs-up'].includes(text)) return 'positive';
  if (['down', 'negative', 'thumbsdown', 'thumbs_down', 'thumbs-down'].includes(text)) return 'negative';
  return text || 'unknown';
}

function classifySurface(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized) return 'unknown';
  for (const rule of SURFACE_RULES) {
    if (rule.pattern.test(normalized)) return rule.key;
  }
  return 'product';
}

function extractCommandTokens(command) {
  const tokens = new Set();
  const text = normalizeText(command);
  if (!text) return [...tokens];

  if (/\bgit push\b/.test(text)) pushToken(tokens, 'cmd:git_push');
  if (/\bgit push\b.*(?:--force|-f)\b/.test(text)) pushToken(tokens, 'cmd:force_push');
  if (/\bgh pr create\b/.test(text)) pushToken(tokens, 'cmd:pr_create');
  if (/\bgh pr merge\b/.test(text)) pushToken(tokens, 'cmd:pr_merge');
  if (/\bnpm publish\b|\byarn publish\b|\bpnpm publish\b/.test(text)) pushToken(tokens, 'cmd:publish');
  if (/\brm -rf\b/.test(text)) pushToken(tokens, 'cmd:destructive_delete');
  if (/\b(test|jest|vitest|coverage|prove:|self-heal:check)\b/.test(text)) pushToken(tokens, 'cmd:verification');
  if (/\b(deploy|release|tag)\b/.test(text)) pushToken(tokens, 'cmd:release');
  if (/\b(readme|docs?)\b/.test(text)) pushToken(tokens, 'cmd:docs');

  pushTextTokens(tokens, 'cmdtok', text, 8);
  return [...tokens];
}

function extractFileTokens(filePath) {
  const tokens = new Set();
  const normalized = String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized) return [...tokens];

  pushToken(tokens, `surface:${classifySurface(normalized)}`);
  const head = normalized.split('/')[0];
  if (head) pushToken(tokens, `path:${head}`);
  const ext = path.extname(normalized).replace('.', '');
  if (ext) pushToken(tokens, `ext:${ext}`);
  return [...tokens];
}

function buildFeatureTokens(parts = []) {
  const tokens = new Set();
  for (const token of parts.flat().filter(Boolean)) {
    pushToken(tokens, token);
  }
  return [...tokens];
}

function maybeReadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function toLocalDayKey(value) {
  const ts = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(ts.getTime())) return null;
  const year = ts.getFullYear();
  const month = String(ts.getMonth() + 1).padStart(2, '0');
  const day = String(ts.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function detectVerificationSignal(text) {
  return /\b(test|tests|verify|verified|verification|coverage|proof|failing|failed|assert|ci)\b/i.test(text);
}

function detectDenySignal(text) {
  return /\b(block|blocked|deny|denied|force push|protected|publish|release|secret|security|credential|rm -rf|destructive)\b/i.test(text);
}

function detectRecallSignal(text) {
  return /\b(recall|lesson|again|repeat|repeated|same pattern|same mistake|prior|history|context|retrieve_lessons)\b/i.test(text);
}

function deriveLabelFromFeedback(entry) {
  const signal = normalizeSignal(entry.signal || entry.feedback);
  if (signal === 'positive') return 'allow';
  if (signal !== 'negative') return 'warn';

  const diagnosis = entry.diagnosis || {};
  const tags = Array.isArray(entry.tags) ? entry.tags.map((tag) => String(tag).toLowerCase()) : [];
  const text = [
    entry.context,
    entry.whatWentWrong,
    entry.what_went_wrong,
    entry.whatToChange,
    entry.what_to_change,
    diagnosis.rootCauseCategory,
    diagnosis.criticalFailureStep,
    tags.join(' '),
  ].filter(Boolean).join(' ');

  if (detectVerificationSignal(text) || String(diagnosis.criticalFailureStep || '').toLowerCase() === 'verification') {
    return 'verify';
  }
  if (detectDenySignal(text)) {
    return 'warn';
  }
  if (detectRecallSignal(text) || tags.some((tag) => tag.includes('repeat') || tag.includes('lesson'))) {
    return 'recall';
  }
  return 'warn';
}

function deriveLabelFromAudit(entry) {
  const decision = normalizeText(entry.decision);
  if (decision === 'allow') return 'allow';
  if (decision === 'deny') return 'deny';
  if (decision === 'warn') return 'warn';
  return null;
}

function deriveLabelFromDiagnostic(entry) {
  const diagnosis = entry && entry.diagnosis ? entry.diagnosis : {};
  const rootCause = String(diagnosis.rootCauseCategory || '').toLowerCase();
  const step = String(diagnosis.criticalFailureStep || entry.step || '').toLowerCase();
  const text = [rootCause, step, entry.context].filter(Boolean).join(' ');

  if (detectDenySignal(text) || rootCause === 'guardrail_triggered') return 'deny';
  if (step === 'verification' || detectVerificationSignal(text)) return 'verify';
  if (detectRecallSignal(text) || /intent|context|plan|memory|retrieval/.test(rootCause)) return 'recall';
  return 'warn';
}

function buildFeedbackExample(entry) {
  const label = deriveLabelFromFeedback(entry);
  const diagnosis = entry.diagnosis || {};
  const toolName = entry.toolName || entry.tool_name || diagnosis.toolName || 'unknown';
  const tokens = buildFeatureTokens([
    `kind:feedback`,
    `signal:${normalizeSignal(entry.signal || entry.feedback)}`,
    `tool:${toolName}`,
    entry.skill ? `skill:${entry.skill}` : null,
    diagnosis.rootCauseCategory ? `root:${diagnosis.rootCauseCategory}` : null,
    diagnosis.criticalFailureStep ? `step:${diagnosis.criticalFailureStep}` : null,
    ...extractCommandTokens(entry.context || ''),
    ...(Array.isArray(entry.tags) ? entry.tags.map((tag) => `tag:${String(tag).toLowerCase()}`) : []),
    ...(entry.richContext && Array.isArray(entry.richContext.filePaths)
      ? entry.richContext.filePaths.flatMap((filePath) => extractFileTokens(filePath))
      : []),
    ...pushableDiagnosisViolationTokens(diagnosis),
    ...tokenizeText([
      entry.context,
      entry.whatWentWrong,
      entry.what_went_wrong,
      entry.whatToChange,
      entry.what_to_change,
    ].filter(Boolean).join(' '), 10).map((token) => `text:${token}`),
  ]);

  if (!tokens.length) return null;
  return {
    id: entry.id || null,
    source: 'feedback',
    label,
    timestamp: entry.timestamp || new Date().toISOString(),
    tokens,
  };
}

function pushableDiagnosisViolationTokens(diagnosis = {}) {
  const tokens = [];
  const violations = Array.isArray(diagnosis.violations) ? diagnosis.violations : [];
  for (const violation of violations) {
    if (violation && violation.constraintId) {
      tokens.push(`constraint:${violation.constraintId}`);
    }
  }
  return tokens;
}

function buildAuditExample(entry) {
  const label = deriveLabelFromAudit(entry);
  if (!label) return null;
  const toolInput = entry.toolInput && typeof entry.toolInput === 'object' ? entry.toolInput : {};
  const changedFiles = []
    .concat(Array.isArray(toolInput.changed_files) ? toolInput.changed_files : [])
    .concat(Array.isArray(toolInput.changedFiles) ? toolInput.changedFiles : [])
    .concat(typeof toolInput.filePath === 'string' ? [toolInput.filePath] : [])
    .concat(typeof toolInput.file_path === 'string' ? [toolInput.file_path] : [])
    .filter(Boolean);
  const tokens = buildFeatureTokens([
    'kind:audit',
    `decision:${entry.decision || 'allow'}`,
    `tool:${entry.toolName || 'unknown'}`,
    entry.gateId ? `gate:${entry.gateId}` : null,
    entry.source ? `source:${entry.source}` : null,
    entry.severity ? `severity:${entry.severity}` : null,
    ...extractCommandTokens(toolInput.command || ''),
    ...changedFiles.flatMap((filePath) => extractFileTokens(filePath)),
    ...tokenizeText(entry.message || '', 8).map((token) => `msg:${token}`),
  ]);

  return {
    id: entry.id || null,
    source: 'audit',
    label,
    timestamp: entry.timestamp || new Date().toISOString(),
    tokens,
  };
}

function buildDiagnosticExample(entry) {
  const label = deriveLabelFromDiagnostic(entry);
  const diagnosis = entry.diagnosis || {};
  const tokens = buildFeatureTokens([
    'kind:diagnostic',
    entry.source ? `source:${entry.source}` : null,
    diagnosis.rootCauseCategory ? `root:${diagnosis.rootCauseCategory}` : null,
    diagnosis.criticalFailureStep ? `step:${diagnosis.criticalFailureStep}` : null,
    ...pushableDiagnosisViolationTokens(diagnosis),
    ...(entry.metadata && Array.isArray(entry.metadata.tags)
      ? entry.metadata.tags.map((tag) => `tag:${String(tag).toLowerCase()}`)
      : []),
    ...(entry.metadata && entry.metadata.skill ? [`skill:${entry.metadata.skill}`] : []),
    ...tokenizeText(entry.context || '', 10).map((token) => `ctx:${token}`),
  ]);

  if (!tokens.length) return null;
  return {
    id: entry.id || null,
    source: 'diagnostic',
    label,
    timestamp: entry.timestamp || new Date().toISOString(),
    tokens,
  };
}

function deriveLabelFromDecisionOutcome(outcome) {
  const status = normalizeText(outcome && outcome.outcome);
  const actualDecision = normalizeText(outcome && outcome.actualDecision);
  if (status === 'blocked' || status === 'rolled_back' || actualDecision === 'deny') return 'deny';
  if (status === 'warned' || status === 'overridden' || actualDecision === 'warn') return 'warn';
  if (status === 'accepted' || status === 'completed') return 'allow';
  if (status === 'aborted') return 'warn';
  return null;
}

function buildDecisionExample(action) {
  const evaluation = action && action.evaluation ? action.evaluation : null;
  const latestOutcome = action && Array.isArray(action.outcomes) && action.outcomes.length > 0
    ? action.outcomes[action.outcomes.length - 1]
    : null;
  const label = deriveLabelFromDecisionOutcome(latestOutcome);
  if (!evaluation || !latestOutcome || !label) return null;

  const recommendation = evaluation.recommendation || {};
  const blastRadius = evaluation.blastRadius || {};
  const toolInput = evaluation.toolInput && typeof evaluation.toolInput === 'object' ? evaluation.toolInput : {};
  const changedFiles = Array.isArray(evaluation.changedFiles) ? evaluation.changedFiles : [];
  const tokens = buildFeatureTokens([
    'kind:decision',
    `tool:${evaluation.toolName || latestOutcome.toolName || 'unknown'}`,
    `decision:${recommendation.decision || 'allow'}`,
    `execution:${recommendation.executionMode || 'auto_execute'}`,
    `owner:${recommendation.decisionOwner || 'agent'}`,
    `reversibility:${recommendation.reversibility || 'reviewable'}`,
    recommendation.riskBand ? `risk:${recommendation.riskBand}` : null,
    blastRadius.severity ? `blast:${blastRadius.severity}` : null,
    latestOutcome.outcome ? `outcome:${latestOutcome.outcome}` : null,
    latestOutcome.actor ? `actor:${latestOutcome.actor}` : null,
    ...extractCommandTokens(toolInput.command || ''),
    ...changedFiles.flatMap((filePath) => extractFileTokens(filePath)),
    ...tokenizeText([recommendation.summary, latestOutcome.notes].filter(Boolean).join(' '), 10).map((token) => `decisiontok:${token}`),
  ]);

  if (!tokens.length) return null;
  return {
    id: latestOutcome.actionId || evaluation.actionId || null,
    source: 'decision',
    label,
    timestamp: latestOutcome.timestamp || evaluation.timestamp || new Date().toISOString(),
    tokens,
  };
}

function buildExamplesFromFeedbackDir(feedbackDir) {
  const resolvedDir = resolveFeedbackDir({ feedbackDir });
  const feedbackEntries = readJSONL(path.join(resolvedDir, 'feedback-log.jsonl'));
  const auditEntries = readJSONL(path.join(resolvedDir, 'audit-trail.jsonl'));
  const diagnosticEntries = readJSONL(path.join(resolvedDir, 'diagnostic-log.jsonl'));
  const decisionEntries = readDecisionLog(getDecisionLogPath(resolvedDir));
  const decisions = collapseDecisionTimeline(decisionEntries);

  const examples = [];
  const sourceCounts = { feedback: 0, audit: 0, diagnostic: 0, decision: 0 };

  for (const entry of feedbackEntries) {
    const example = buildFeedbackExample(entry);
    if (!example) continue;
    sourceCounts.feedback += 1;
    examples.push(example);
  }
  for (const entry of auditEntries) {
    const example = buildAuditExample(entry);
    if (!example) continue;
    sourceCounts.audit += 1;
    examples.push(example);
  }
  for (const entry of diagnosticEntries) {
    const example = buildDiagnosticExample(entry);
    if (!example) continue;
    sourceCounts.diagnostic += 1;
    examples.push(example);
  }
  for (const action of decisions) {
    const example = buildDecisionExample(action);
    if (!example) continue;
    sourceCounts.decision += 1;
    examples.push(example);
  }

  examples.sort((left, right) => {
    return Date.parse(left.timestamp || 0) - Date.parse(right.timestamp || 0);
  });

  return {
    examples,
    sourceCounts,
  };
}

function splitExamples(examples) {
  if (examples.length < MIN_HOLDOUT_EXAMPLES * 2) {
    return { train: examples.slice(), holdout: [] };
  }
  const holdoutSize = Math.max(MIN_HOLDOUT_EXAMPLES, Math.floor(examples.length * DEFAULT_HOLDOUT_RATIO));
  const splitIndex = Math.max(MIN_TRAINING_EXAMPLES, examples.length - holdoutSize);
  return {
    train: examples.slice(0, splitIndex),
    holdout: examples.slice(splitIndex),
  };
}

function createEmptyModel() {
  return {
    version: 1,
    modelType: 'multinomial_naive_bayes',
    labels: LABELS.slice(),
    exampleCount: 0,
    labelCounts: Object.fromEntries(LABELS.map((label) => [label, 0])),
    labelTokenTotals: Object.fromEntries(LABELS.map((label) => [label, 0])),
    labelTokenCounts: Object.fromEntries(LABELS.map((label) => [label, {}])),
    vocabularySize: 0,
    metrics: {
      trainingAccuracy: 0,
      holdoutAccuracy: 0,
      holdoutSize: 0,
    },
    sourceCounts: {},
    updatedAt: null,
  };
}

function fitNaiveBayes(examples) {
  const model = createEmptyModel();
  const vocabulary = new Set();

  for (const example of examples) {
    const label = LABELS.includes(example.label) ? example.label : 'warn';
    model.exampleCount += 1;
    model.labelCounts[label] += 1;

    for (const token of example.tokens || []) {
      const normalized = String(token || '').trim();
      if (!normalized) continue;
      vocabulary.add(normalized);
      model.labelTokenCounts[label][normalized] = (model.labelTokenCounts[label][normalized] || 0) + 1;
      model.labelTokenTotals[label] += 1;
    }
  }

  model.vocabularySize = vocabulary.size;
  return model;
}

function scoreExample(model, tokens) {
  const totalExamples = Math.max(1, model.exampleCount || 0);
  const raw = {};
  const uniqueTokens = [...new Set(tokens || [])];

  for (const label of LABELS) {
    const labelCount = model.labelCounts[label] || 0;
    const prior = Math.log((labelCount + 1) / (totalExamples + LABELS.length));
    const counts = model.labelTokenCounts[label] || {};
    let score = prior;
    for (const token of uniqueTokens) {
      const count = counts[token] || 0;
      if (count > 0) {
        score += Math.log((count + 1) / (labelCount + 1));
      }
    }
    raw[label] = score;
  }

  const maxScore = Math.max(...Object.values(raw));
  const exps = Object.fromEntries(Object.entries(raw).map(([label, score]) => [label, Math.exp(score - maxScore)]));
  const total = Object.values(exps).reduce((sum, value) => sum + value, 0) || 1;
  const probabilities = Object.fromEntries(Object.entries(exps).map(([label, value]) => [label, value / total]));
  const ranked = [...LABELS].sort((left, right) => probabilities[right] - probabilities[left]);

  return {
    label: ranked[0],
    confidence: Number((probabilities[ranked[0]] || 0).toFixed(4)),
    probabilities: Object.fromEntries(ranked.map((label) => [label, Number((probabilities[label] || 0).toFixed(4))])),
  };
}

function evaluateModel(model, examples) {
  if (!Array.isArray(examples) || examples.length === 0) {
    return {
      accuracy: 0,
      total: 0,
      correct: 0,
      labelMetrics: Object.fromEntries(LABELS.map((label) => [label, { total: 0, correct: 0, accuracy: 0 }])),
    };
  }

  let correct = 0;
  const labelMetrics = Object.fromEntries(LABELS.map((label) => [label, { total: 0, correct: 0, accuracy: 0 }]));

  for (const example of examples) {
    const prediction = scoreExample(model, example.tokens);
    labelMetrics[example.label].total += 1;
    if (prediction.label === example.label) {
      correct += 1;
      labelMetrics[example.label].correct += 1;
    }
  }

  for (const label of LABELS) {
    const metric = labelMetrics[label];
    metric.accuracy = Number(safeRate(metric.correct, metric.total).toFixed(4));
  }

  return {
    accuracy: Number(safeRate(correct, examples.length).toFixed(4)),
    total: examples.length,
    correct,
    labelMetrics,
  };
}

function summarizeTopTokens(model, limit = 5) {
  const summary = {};
  for (const label of LABELS) {
    summary[label] = Object.entries(model.labelTokenCounts[label] || {})
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([token, count]) => ({ token, count }));
  }
  return summary;
}

function trainInterventionPolicy(examples, options = {}) {
  const split = splitExamples(examples);
  const evaluationModel = fitNaiveBayes(split.train);
  const deployedModel = fitNaiveBayes(examples);
  const trainingMetrics = evaluateModel(evaluationModel, split.train);
  const holdoutMetrics = evaluateModel(evaluationModel, split.holdout);

  deployedModel.metrics = {
    trainingAccuracy: trainingMetrics.accuracy,
    holdoutAccuracy: holdoutMetrics.accuracy,
    holdoutSize: holdoutMetrics.total,
    trainingExamples: trainingMetrics.total,
  };
  deployedModel.labelMetrics = holdoutMetrics.total > 0 ? holdoutMetrics.labelMetrics : trainingMetrics.labelMetrics;
  deployedModel.topTokens = summarizeTopTokens(deployedModel, options.topTokenLimit || 4);
  deployedModel.updatedAt = new Date().toISOString();

  return deployedModel;
}

function saveInterventionPolicy(model, feedbackDir) {
  const targetPath = modelPathFor(feedbackDir);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(model, null, 2)}\n`);
  return targetPath;
}

function loadInterventionPolicy(feedbackDir) {
  const targetPath = modelPathFor(feedbackDir);
  if (!fs.existsSync(targetPath)) return null;
  return maybeReadJson(targetPath);
}

function trainAndPersistInterventionPolicy(feedbackDir, options = {}) {
  const resolvedDir = resolveFeedbackDir({ feedbackDir });
  const { examples, sourceCounts } = buildExamplesFromFeedbackDir(resolvedDir);
  const model = trainInterventionPolicy(examples, options);
  model.sourceCounts = sourceCounts;
  const modelPath = saveInterventionPolicy(model, resolvedDir);
  return {
    model,
    modelPath,
    examples,
    sourceCounts,
  };
}

function buildRuntimeCandidate(params = {}) {
  const affectedFiles = Array.isArray(params.affectedFiles) ? params.affectedFiles : [];
  const blockers = params.integrity && Array.isArray(params.integrity.blockers) ? params.integrity.blockers : [];
  const memoryGuard = params.memoryGuard || {};
  const blastRadius = params.blastRadius || {};
  const protectedSurface = params.protectedSurface || {};
  const tokens = buildFeatureTokens([
    'kind:runtime',
    `tool:${params.toolName || 'unknown'}`,
    params.riskBand ? `risk:${params.riskBand}` : null,
    blastRadius.severity ? `blast:${blastRadius.severity}` : null,
    memoryGuard.mode ? `memory:${memoryGuard.mode}` : null,
    params.taskScopeViolation ? `scope:${params.taskScopeViolation.reasonCode || 'violation'}` : null,
    blastRadius.surfaceCount >= 3 ? 'shape:multi_surface' : blastRadius.surfaceCount >= 2 ? 'shape:two_surface' : 'shape:single_surface',
    affectedFiles.length >= 4 ? 'shape:multi_file' : affectedFiles.length > 0 ? 'shape:small_file_set' : 'shape:no_files',
    (protectedSurface.unapprovedProtectedFiles || []).length > 0 ? 'protected:unapproved' : null,
    (blastRadius.releaseSensitiveFiles || []).length > 0 ? 'release:sensitive' : null,
    ...extractCommandTokens(params.command || ''),
    ...affectedFiles.flatMap((filePath) => extractFileTokens(filePath)),
    ...blockers.slice(0, 6).map((blocker) => `blocker:${blocker.code || 'unknown'}`),
    ...tokenizeText(memoryGuard.reason || '', 6).map((token) => `memorytok:${token}`),
  ]);

  return {
    tokens,
    metadata: {
      toolName: params.toolName || 'unknown',
      affectedFiles,
      blockerCount: blockers.length,
    },
  };
}

function getInterventionRecommendation(params = {}, options = {}) {
  const resolvedDir = resolveFeedbackDir({ feedbackDir: options.feedbackDir || params.feedbackDir });
  let model = options.model || loadInterventionPolicy(resolvedDir);
  const candidate = options.candidate || buildRuntimeCandidate(params);

  if (!model) {
    const bootstrapped = buildExamplesFromFeedbackDir(resolvedDir);
    if (bootstrapped.examples.length >= MIN_TRAINING_EXAMPLES) {
      const trained = trainAndPersistInterventionPolicy(resolvedDir);
      model = trained.model;
    }
  }

  if (!model || Number(model.exampleCount || 0) < MIN_TRAINING_EXAMPLES) {
    return {
      enabled: false,
      reason: 'insufficient_training_examples',
      exampleCount: Number(model && model.exampleCount || 0),
      candidate,
    };
  }

  const prediction = scoreExample(model, candidate.tokens);
  return {
    enabled: true,
    candidate,
    prediction,
    metrics: model.metrics || {},
    topTokens: model.topTokens && model.topTokens[prediction.label]
      ? model.topTokens[prediction.label]
      : [],
    updatedAt: model.updatedAt || null,
    exampleCount: model.exampleCount || 0,
  };
}

function computeDailySeries(examples, dayCount = 14) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const byDay = new Map();
  for (const example of examples) {
    const dayKey = toLocalDayKey(example.timestamp);
    if (!dayKey) continue;
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, Object.fromEntries([...LABELS, 'total'].map((label) => [label, 0])));
    }
    const record = byDay.get(dayKey);
    record[example.label] += 1;
    record.total += 1;
  }

  const days = [];
  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - offset);
    const dayKey = toLocalDayKey(day);
    const record = byDay.get(dayKey) || Object.fromEntries([...LABELS, 'total'].map((label) => [label, 0]));
    days.push({ dayKey, ...record });
  }
  return days;
}

function getInterventionPolicySummary(feedbackDir, options = {}) {
  const resolvedDir = resolveFeedbackDir({ feedbackDir });
  const { examples, sourceCounts } = buildExamplesFromFeedbackDir(resolvedDir);
  const model = loadInterventionPolicy(resolvedDir) || trainInterventionPolicy(examples);
  const labelCounts = Object.assign({}, model.labelCounts || {});
  const daily = computeDailySeries(examples, options.dayCount || 14);
  const recent = daily.slice(-7).reduce((acc, day) => {
    for (const label of LABELS) {
      acc[label] += day[label] || 0;
    }
    acc.total += day.total || 0;
    return acc;
  }, Object.fromEntries([...LABELS, 'total'].map((label) => [label, 0])));

  return {
    enabled: Number(model.exampleCount || 0) >= MIN_TRAINING_EXAMPLES,
    modelType: model.modelType,
    exampleCount: model.exampleCount || 0,
    updatedAt: model.updatedAt || null,
    labelCounts,
    metrics: model.metrics || {},
    sourceCounts,
    topTokens: model.topTokens || {},
    daily,
    recent,
    nonAllowRate: Number(safeRate(
      (recent.recall || 0) + (recent.verify || 0) + (recent.warn || 0) + (recent.deny || 0),
      recent.total || 0
    ).toFixed(4)),
  };
}

module.exports = {
  LABELS,
  MIN_TRAINING_EXAMPLES,
  buildExamplesFromFeedbackDir,
  buildRuntimeCandidate,
  createEmptyModel,
  getInterventionPolicySummary,
  getInterventionRecommendation,
  loadInterventionPolicy,
  modelPathFor,
  predictIntervention: scoreExample,
  readJSONL,
  saveInterventionPolicy,
  trainAndPersistInterventionPolicy,
  trainInterventionPolicy,
};

function isDirectExecution() {
  if (!Array.isArray(process.argv) || !process.argv[1]) return false;
  return path.resolve(process.argv[1]) === __filename;
}

if (isDirectExecution()) {
  const feedbackDir = process.argv[2] || resolveFeedbackDir();
  const { modelPath, model } = trainAndPersistInterventionPolicy(feedbackDir);
  process.stdout.write(`${JSON.stringify({ modelPath, model }, null, 2)}\n`);
}
