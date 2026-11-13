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
const READ_ONLY_TOOLS = Object.freeze(['read', 'grep', 'glob']);
const HOST_INSTRUCTION = /(?:^|\/)(?:AGENTS|CLAUDE|GEMINI)\.md$/i;
const LESSON_LOG = /(?:memory-log|feedback-log|prior-lessons)/i;

function buildGoldfishReviewPacket({
  targetFile = '',
  authorSessionId = '',
  reviewerSessionId = '',
  linkedFiles = [],
  reauditCount = 0,
  findings = [],
  reviewerTools = null,
  stages = null,
  comprehensionFiles = null,
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
  const reaudits = Number(reauditCount);
  if (!Number.isInteger(reaudits) || reaudits < 0 || reaudits > MAX_REAUDITS) {
    reasons.push('reaudit_cap_exceeded');
  }
  if (!Array.isArray(findings) || findings.some((finding) => {
    const rank = String(finding && finding.rank || '').trim().toLowerCase();
    return !RANKS.includes(rank);
  })) {
    reasons.push('unranked_finding');
  }
  const declaredTools = reviewerTools == null
    ? READ_ONLY_TOOLS
    : (Array.isArray(reviewerTools) ? reviewerTools : [reviewerTools]).map((tool) => String(tool || '').trim().toLowerCase());
  if (declaredTools.length === 0 || declaredTools.some((tool) => !READ_ONLY_TOOLS.includes(tool))) {
    reasons.push('reviewer_tools_not_read_only');
  }
  if (stages != null) {
    const list = Array.isArray(stages) ? stages : [];
    if (list.length !== STAGES.length || list.some((stage, index) => stage !== STAGES[index])) {
      reasons.push('stages_out_of_order');
    }
  }
  const comprehension = comprehensionFiles == null
    ? [target].filter(Boolean)
    : (Array.isArray(comprehensionFiles) ? comprehensionFiles : []).map((file) => String(file || '').trim()).filter(Boolean);
  if (!target || comprehension.length !== 1 || comprehension[0] !== target) {
    reasons.push('comprehension_must_read_target_only');
  }
  const goldfish = reasons.length === 0;
  return {
    goldfish,
    reasons,
    stages: STAGES,
    ranks: RANKS,
    maxReaudits: MAX_REAUDITS,
    contextFiles: goldfish ? files : [],
    comprehensionFiles: goldfish ? [target] : [],
    reviewerTools: goldfish ? READ_ONLY_TOOLS : [],
    comprehensionReadsTargetOnly: goldfish,
  };
}

module.exports = {
  STAGES,
  RANKS,
  MAX_REAUDITS,
  buildGoldfishReviewPacket,
};
