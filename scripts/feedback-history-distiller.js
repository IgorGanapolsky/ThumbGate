'use strict';

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir: resolveSharedFeedbackDir } = require('./feedback-paths');
const { readJsonlTail } = require('./fs-utils');
const { redactSecretsDeep } = require('./secret-redaction');

const DEFAULT_HISTORY_LIMIT = 10;

// A correction pushes back on something done. An ordinary request ("use X", "it should be centred") is not one.
const CORRECTION_PATTERNS = [
  /^(?:(?:no|again|please|hey)[,.!\s]+)*(?:don['’]?t|do not|never|stop|avoid|quit)\b/i,
  /\byou\s+(?:ignored|didn['’]?t|did not|keep|kept|forgot|skipped|broke|should(?:n['’]?t)? have|were (?:told|supposed))\b/i,
  /\bi\s+(?:already\s+)?(?:told|asked|said)\b/i,
  /\b(?:not what i|should(?:n['’]?t)? have)\b/i,
];
// Longer than this is a brief or a report, whatever words it contains.
const MAX_CORRECTION_CHARS = 400;
// Text another agent or the harness put into the conversation.
const AGENT_REPORT = /<(?:agent-message|teammate-message|task-notification|system-reminder|channel)\b|another claude session sent a message|\bsubagent (?:report|hand-?back)\b|\[subagent hand-?back\]/i;
const NOT_RECORDED = 'Not recorded: no thumbs-down or correction from the person.';

function isFromPerson(entry) {
  return !/^(?:assistant|tool|system|agent)$/i.test(String(entry.author || '')) && !AGENT_REPORT.test(String(entry.text || ''));
}

function isCorrection(text) {
  return text.length <= MAX_CORRECTION_CHARS && matchesAny(text, CORRECTION_PATTERNS);
}

// What the prompt hook may record by itself: a typed thumbs-down, or a short message that says the work was wrong.
// The words appearing somewhere inside a request or a report do not count.
function isTypedThumbsDown(prompt) {
  const text = String(prompt || '').trim();
  if (AGENT_REPORT.test(text)) return false;
  if (/^(?:👎|thumbs?[ -]?down\b)/iu.test(text)) return true;
  if (text.length > MAX_CORRECTION_CHARS) return false;
  return /👎|\bthumbs?[ -]?down[.!]*$/iu.test(text)
    || /^(?:(?:no|and|but)[,.\s]+)?that (?:failed|was wrong)\b/i.test(text)
    || /^fix this\W*$/i.test(text)
    || isCorrection(text);
}

const FAILURE_PATTERNS = [
  /\bfailed\b/i,
  /\bbroke\b/i,
  /\berror\b/i,
  /\bwrong\b/i,
  /\bignored\b/i,
  /\bskipped\b/i,
  /\bhallucinat/i,
  /\bclaimed done\b/i,
  /\bwithout proof\b/i,
  /\bwithout evidence\b/i,
];

const SUCCESS_PATTERNS = [
  /\bworked\b/i,
  /\bpassed\b/i,
  /\bverified\b/i,
  /\bproof\b/i,
  /\bevidence\b/i,
  /\btests?\b/i,
  /\bfixed\b/i,
  /\bsuccess/i,
];

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value, max = 180) {
  const text = normalizeText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function appendJsonl(filePath, record) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Redact secrets before any conversation turn touches disk — conversation-window.jsonl was the
  // 2026-06-10 sk_live_ leak vector. See scripts/secret-redaction.js.
  fs.appendFileSync(filePath, `${JSON.stringify(redactSecretsDeep(record))}\n`);
}

function resolveFeedbackDir(feedbackDir) {
  if (feedbackDir) {
    return resolveSharedFeedbackDir({ feedbackDir });
  }
  const env = { ...process.env };
  delete env.INIT_CWD;
  delete env.PWD;
  return resolveSharedFeedbackDir({ env });
}

function getConversationPaths(feedbackDir) {
  const resolved = resolveFeedbackDir(feedbackDir);
  return {
    feedbackDir: resolved,
    conversationLogPath: path.join(resolved, 'conversation-window.jsonl'),
    feedbackLogPath: path.join(resolved, 'feedback-log.jsonl'),
  };
}

function normalizeChatHistory(entries = []) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => {
      if (typeof entry === 'string') {
        const text = normalizeText(entry);
        return text ? { author: null, text, timestamp: null, source: 'chat_history' } : null;
      }
      if (!entry || typeof entry !== 'object') return null;
      const text = normalizeText(entry.text || entry.body || entry.message || entry.content);
      if (!text) return null;
      return {
        author: normalizeText(entry.author || entry.role || entry.user || entry.name) || null,
        text,
        timestamp: normalizeText(entry.timestamp || entry.createdAt || entry.updatedAt) || null,
        source: normalizeText(entry.source) || 'chat_history',
      };
    })
    .filter(Boolean);
}

function recordConversationEntry(entry, options = {}) {
  const { conversationLogPath } = getConversationPaths(options.feedbackDir);
  const normalized = normalizeChatHistory([entry])[0];
  if (!normalized) {
    return { recorded: false, reason: 'empty_text', conversationLogPath };
  }
  const record = {
    ...require('./project-identity').projectForCapture(entry || {}, options),
    ...normalized,
    timestamp: normalized.timestamp || new Date().toISOString(),
  };
  appendJsonl(conversationLogPath, record);
  return { recorded: true, record, conversationLogPath };
}

function readRecentConversationWindow(options = {}) {
  const limit = Number(options.limit || DEFAULT_HISTORY_LIMIT);
  const { conversationLogPath } = getConversationPaths(options.feedbackDir);
  return (options.projectKey != null ? require('./project-catalog').readProjectRows(path.dirname(conversationLogPath), 'conversation-window.jsonl', options).slice(-limit) : readJsonlTail(conversationLogPath, limit))
    .map((entry) => normalizeChatHistory([entry])[0])
    .filter(Boolean);
}

function findFeedbackEventById(feedbackId, options = {}) {
  if (!feedbackId) return null;
  const { feedbackLogPath } = getConversationPaths(options.feedbackDir);
  const matches = options.projectKey != null ? require('./project-catalog').readProjectRows(path.dirname(feedbackLogPath), 'feedback-log.jsonl', options).slice(-Number(options.searchLimit || 200)) : readJsonlTail(feedbackLogPath, Number(options.searchLimit || 200));
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    if (matches[index] && matches[index].id === feedbackId) {
      return matches[index];
    }
  }
  return null;
}

function buildLastActionMessage(lastAction) {
  if (!lastAction || typeof lastAction !== 'object') return null;
  const tool = normalizeText(lastAction.tool || lastAction.tool_name || 'unknown tool');
  const file = normalizeText(lastAction.file || lastAction.path || '');
  const detail = file ? `${tool} on ${file}` : tool;
  return {
    author: 'tool',
    text: `Last action: ${detail}`,
    timestamp: normalizeText(lastAction.timestamp) || null,
    source: 'last_action',
  };
}

function buildRelatedFeedbackMessages(feedbackEvent) {
  if (!feedbackEvent || typeof feedbackEvent !== 'object') return [];
  const messages = [];

  if (feedbackEvent.conversationWindow && Array.isArray(feedbackEvent.conversationWindow)) {
    for (const entry of normalizeChatHistory(feedbackEvent.conversationWindow)) {
      messages.push({ ...entry, source: 'related_feedback_window' });
    }
  }

  const snippets = [
    feedbackEvent.submittedContext || null,
    feedbackEvent.context || null,
    feedbackEvent.whatWentWrong || null,
    feedbackEvent.whatWorked || null,
    feedbackEvent.whatToChange || null,
  ].filter(Boolean);

  for (const text of snippets) {
    messages.push({
      author: 'related-feedback',
      text: normalizeText(text),
      timestamp: normalizeText(feedbackEvent.timestamp) || null,
      source: 'related_feedback',
    });
  }

  const lastActionMessage = buildLastActionMessage(feedbackEvent.lastAction);
  if (lastActionMessage) messages.push(lastActionMessage);

  return messages;
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function chooseMessage(messages, predicate) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (predicate(messages[index])) return messages[index];
  }
  return null;
}

function buildRuleSuggestion(correctionMessage, signal) {
  if (!correctionMessage) return null;
  const text = truncate(correctionMessage.text, 120);
  if (signal === 'negative' && /\bnever\b/i.test(text)) return text;
  if (signal === 'negative' && /\bdo not\b/i.test(text)) {
    return text.replace(/\bdo not\b/i, 'Never');
  }
  if (signal === 'negative' && /\bdon['’]?t\b/i.test(text)) {
    return text
      .replace(/\bdon['’]?t\b/i, 'Never')
      .replace(/\bdo not\b/i, 'Never');
  }
  if (signal === 'negative' && /\bavoid\b/i.test(text)) {
    return text.replace(/\bavoid\b/i, 'Avoid');
  }
  if (signal === 'negative') return `Follow the earlier instruction: ${text}`;
  return `Repeat the successful pattern: ${text}`;
}

function isCaptureFragment(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const { isTranscriptShaped } = require('./project-scope');
  return isTranscriptShaped(raw);
}

function inferNegativeDistillation(messages, params) {
  const correctionMessage = chooseMessage(messages, (entry) => {
    const text = normalizeText(entry.text);
    return Boolean(text) && !isCaptureFragment(text) && isFromPerson(entry) && isCorrection(text);
  });

  const failureMessage = chooseMessage(messages, (entry) => {
    const text = normalizeText(entry.text);
    return Boolean(text) && !isCaptureFragment(text) && !AGENT_REPORT.test(text) && matchesAny(text, FAILURE_PATTERNS);
  }) || (() => {
    const fallback = buildLastActionMessage(params.lastAction);
    return fallback && !isCaptureFragment(fallback.text) ? fallback : null;
  })();

  if (!correctionMessage && !failureMessage) {
    return {
      usedHistory: false,
      inferredFields: {},
      lessonProposal: null,
      evidence: [],
      source: 'none',
    };
  }

  const evidence = [correctionMessage, failureMessage].filter(Boolean).map((entry) => truncate(entry.text));
  const { stripLessonMarkup } = require('./lesson-hook-relevance');
  const quoted = (message) => truncate(stripLessonMarkup(message.text), 140);
  const whatWentWrong = correctionMessage
    ? `It ignored a prior instruction: ${quoted(correctionMessage)}`
    : `The failure centered on: ${truncate(failureMessage.text, 140)}`;
  const whatToChange = correctionMessage
    ? `Follow the earlier instruction instead of repeating the same pattern: ${quoted(correctionMessage)}`
    : failureMessage
      ? `Inspect and correct the failing step before repeating it: ${truncate(failureMessage.text, 140)}`
      : null;
  const context = failureMessage
    ? `History-aware distillation linked this failure to ${truncate(failureMessage.text, 140)}`
    : `History-aware distillation linked this failure to ${truncate(correctionMessage.text, 140)}`;

  return {
    usedHistory: true,
    source: correctionMessage ? correctionMessage.source : failureMessage.source,
    inferredFields: {
      context,
      whatWentWrong,
      whatToChange,
    },
    lessonProposal: {
      summary: whatWentWrong,
      proposedRule: buildRuleSuggestion(correctionMessage, 'negative'),
      confidence: correctionMessage && failureMessage ? 0.92 : 0.78,
    },
    evidence,
  };
}

function inferPositiveDistillation(messages) {
  const successMessage = chooseMessage(messages, (entry) => {
    const text = normalizeText(entry.text);
    return Boolean(text) && matchesAny(text, SUCCESS_PATTERNS);
  });

  if (!successMessage) {
    return {
      usedHistory: false,
      inferredFields: {},
      lessonProposal: null,
      evidence: [],
      source: 'none',
    };
  }

  const whatWorked = `The successful pattern was: ${truncate(successMessage.text, 140)}`;
  return {
    usedHistory: true,
    source: successMessage.source,
    inferredFields: {
      context: `History-aware distillation found a successful pattern in recent conversation: ${truncate(successMessage.text, 140)}`,
      whatWorked,
    },
    lessonProposal: {
      summary: whatWorked,
      proposedRule: buildRuleSuggestion(successMessage, 'positive'),
      confidence: 0.81,
    },
    evidence: [truncate(successMessage.text)],
  };
}

function distillFeedbackHistory(params = {}) {
  const signal = String(params.signal || '').toLowerCase().trim();
  const historyLimit = Number(params.historyLimit || DEFAULT_HISTORY_LIMIT);
  const explicitHistory = normalizeChatHistory(params.chatHistory || params.messages || []);
  const fallbackHistory = params.allowLocalConversationFallback
    ? readRecentConversationWindow({ feedbackDir: params.feedbackDir, projectKey: params.projectKey, limit: historyLimit })
    : [];
  const relatedEvent = findFeedbackEventById(params.relatedFeedbackId, {
    feedbackDir: params.feedbackDir,
    projectKey: params.projectKey,
    searchLimit: params.searchLimit,
  });

  const conversationWindow = [
    ...explicitHistory,
    ...(explicitHistory.length === 0 ? fallbackHistory : []),
    ...buildRelatedFeedbackMessages(relatedEvent),
  ]
    .filter((entry) => entry && normalizeText(entry.text))
    .slice(-historyLimit);

  const distillation = signal === 'negative'
    ? inferNegativeDistillation(conversationWindow, params)
    : inferPositiveDistillation(conversationWindow, params);

  return {
    usedHistory: distillation.usedHistory,
    source: explicitHistory.length > 0
      ? 'chat_history'
      : fallbackHistory.length > 0
        ? 'local_conversation_window'
        : relatedEvent ? 'related_feedback' : 'none',
    conversationWindow,
    relatedFeedbackId: relatedEvent ? relatedEvent.id : null,
    inferredFields: distillation.inferredFields,
    lessonProposal: distillation.lessonProposal,
    evidence: distillation.evidence,
  };
}

function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (command !== 'record') {
    console.error('Usage: node scripts/feedback-history-distiller.js record --author=user --text="..."');
    process.exit(1);
  }

  const args = {};
  for (const token of rest) {
    if (!token.startsWith('--')) continue;
    const [key, ...valueParts] = token.slice(2).split('=');
    args[key] = valueParts.join('=');
  }

  const result = recordConversationEntry({
    author: args.author || null,
    text: args.text || '',
    timestamp: args.timestamp || new Date().toISOString(),
    source: args.source || 'cli_record',
  }, {
    feedbackDir: args.feedbackDir,
  });

  if (!result.recorded) {
    console.error(result.reason || 'failed_to_record');
    process.exit(1);
  }

  process.stdout.write(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_HISTORY_LIMIT,
  distillFeedbackHistory,
  findFeedbackEventById,
  getConversationPaths,
  isTypedThumbsDown,
  NOT_RECORDED,
  normalizeChatHistory,
  readRecentConversationWindow,
  recordConversationEntry,
};
