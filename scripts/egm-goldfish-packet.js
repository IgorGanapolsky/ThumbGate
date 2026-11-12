'use strict';

// Google Elephant-Goldfish review contract, local and not a plugin clone.
// A Goldfish reads the target and linked repo files only. Host instructions,
// lesson logs, and the author session are not context. A same-session
// self-grade is not a review.

const STAGES = Object.freeze([
  'zoom_out',
  'comprehension',
  'critic',
  'intermediate_zoom_out',
  'implementation_readiness',
]);

const RANKS = Object.freeze(['blocker', 'major', 'nit']);
const MAX_REAUDITS = 1;
const HOST_INSTRUCTION = /(?:^|\/)(?:AGENTS|CLAUDE|GEMINI)\.md$/i;
const LESSON_LOG = /(?:memory-log|feedback-log|prior-lessons)/i;

function buildGoldfishReviewPacket({
  targetFile = '',
  authorSessionId = '',
  reviewerSessionId = '',
  linkedFiles = [],
} = {}) {
  const reasons = [];
  const target = String(targetFile || '').trim();
  const author = String(authorSessionId || '').trim();
  const reviewer = String(reviewerSessionId || '').trim();
  if (!target) reasons.push('missing_target_file');
  if (!reviewer) reasons.push('missing_reviewer_session');
  if (author && reviewer && author === reviewer) {
    reasons.push('same_session_is_not_a_goldfish_review');
  }
  const files = [target, ...(Array.isArray(linkedFiles) ? linkedFiles : [])]
    .map((file) => String(file || '').trim())
    .filter(Boolean);
  if (files.some((file) => HOST_INSTRUCTION.test(file) || LESSON_LOG.test(file))) {
    reasons.push('host_instructions_or_lessons_leaked_into_goldfish_context');
  }
  return {
    goldfish: reasons.length === 0,
    reasons,
    stages: STAGES,
    ranks: RANKS,
    maxReaudits: MAX_REAUDITS,
    contextFiles: reasons.length === 0 ? files : [],
    comprehensionReadsTargetOnly: true,
  };
}

module.exports = {
  STAGES,
  RANKS,
  MAX_REAUDITS,
  buildGoldfishReviewPacket,
};
