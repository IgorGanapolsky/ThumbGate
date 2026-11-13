'use strict';

/**
 * Deslopify AI Pre-Execution, Interception & Read-Budget Gate Engine
 * Architectural steal from "How to Deslopify Your AI" (https://music.youtube.com/watch?v=QSZKZHeGZr4)
 *
 * Eliminates "AI slop" (shifting cognitive burden from creator to reader) across 3 phases / 9 habits:
 * Phase 1 — Pre-Execution & Point of View:
 *   1. Brain-dump before prompting (require whatYouThink, whatWorriesYou, whatToAvoid).
 *   2. Declare confidence levels (0-100%) to force pushback & steelman opposing views.
 *   3. Anchor on raw voice transcripts (preserve natural cadence & phrasing over sterile outlines).
 * Phase 2 — Execution & Interception:
 *   4. Force 6 divergent directions (including cross-domain lenses like Game Designer).
 *   5. Set early interception checkpoints (thesis -> narrative_arc -> first_section -> full_draft).
 *   6. Run a 4-persona review board (Cold Reader, Domain Skeptic, Busiest Stakeholder, Devil's Advocate).
 * Phase 3 — Codification & Team Culture:
 *   7. Respect the "read budget" (distill into <= 5 sentences; block unedited walls of text).
 *   8. Codify taste into reusable skills (best work + admired work + disliked work -> taste skill).
 *   9. Hold the gate & label raw AI outputs ([AI-GENERATED RESEARCH DUMP — UNEDITED]).
 */

const SLOP_PATTERNS = Object.freeze([
  /\bdelve(?:s|d)? into\b/i,
  /\bit is important to note\b/i,
  /\bin today's fast-paced\b/i,
  /\btestament to\b/i,
  /\btapestry of\b/i,
  /\bmoreover,\s+it\b/i,
  /\bin conclusion,\b/i,
  /\blet's unpack\b/i,
  /\bgame-changer\b/i,
  /\bparadigm shift\b/i,
  /\bseamless(?:ly)? integration\b/i,
]);

const RAW_AI_DUMP_HEADER = '[AI-GENERATED RESEARCH DUMP — UNEDITED]';

const INTERCEPTION_STAGE_ORDER = Object.freeze([
  'pov_brain_dump',
  'outline_and_arc',
  'first_section',
  'full_draft',
]);

/**
 * Split prose into sentences for deterministic 5-sentence Read Budget checks.
 */
function splitSentences(text = '') {
  const cleaned = String(text || '')
    .replace(/^\[AI-GENERATED[^\]]*\]\s*/i, '')
    .trim();
  if (!cleaned) return [];
  return cleaned
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'`(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Scan text for generic AI slop markers and compute a slopScore (0..1).
 */
function detectSlopMarkers(text = '') {
  const raw = String(text || '');
  const matchedMarkers = [];
  for (const regex of SLOP_PATTERNS) {
    const match = raw.match(regex);
    if (match) {
      matchedMarkers.push(match[0]);
    }
  }
  const sentences = splitSentences(raw);
  const wordCount = raw.trim() ? raw.trim().split(/\s+/).length : 0;
  const slopScore = Number(
    Math.min(1, matchedMarkers.length * 0.25 + (sentences.length > 15 ? 0.35 : 0)).toFixed(2)
  );
  return {
    slopScore,
    matchedMarkers,
    sentenceCount: sentences.length,
    wordCount,
  };
}

/**
 * Phase 1 (Habits 1, 2, 3): Pre-Execution Point-of-View, Confidence Pushback & Voice Transcript Anchor Gate
 */
function evaluatePreExecutionPovGate(input = {}) {
  const brainDump = String(input.brainDump || input.voiceTranscript || '').trim();
  const whatYouThink = String(input.whatYouThink || '').trim();
  const whatWorriesYou = String(input.whatWorriesYou || '').trim();
  const whatToAvoid = String(input.whatToAvoid || '').trim();
  const confidencePct =
    input.confidencePct !== undefined && input.confidencePct !== null
      ? Number(input.confidencePct)
      : null;

  const hasStructuredPov = Boolean(whatYouThink && whatWorriesYou && whatToAvoid);
  const hasVoiceBrainDump = brainDump.split(/\s+/).filter(Boolean).length >= 12;
  const povProvided = hasStructuredPov || hasVoiceBrainDump;

  // Habit 2: Force pushback / steelman opposing view when confidence < 85% or undeclared
  const requiresPushback = confidencePct === null || confidencePct < 85;
  const opposingSteelman = requiresPushback
    ? [
        `Steelman Counter-Thesis (Confidence ${confidencePct !== null ? `${confidencePct}%` : 'undeclared'}):`,
        `1. Premise Inversion: What if "${whatYouThink || brainDump.slice(0, 80) || 'the proposed direction'}" is a symptom rather than the root cause?`,
        `2. Failure Mode Check: Your stated worry ("${whatWorriesYou || 'unvalidated assumptions'}") is the most likely reason this fails in production — prove it false with live telemetry before building.`,
        `3. Zero-Build Alternative: What happens if we delete the step instead of optimizing it?`,
      ]
    : [];

  // Habit 3: Extract natural phrasing & cadence anchors from raw voice transcript
  const voiceCadenceAnchors = hasVoiceBrainDump
    ? brainDump
        .split(/[,.;—-]+/)
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.split(/\s+/).length >= 3 && chunk.split(/\s+/).length <= 12)
        .slice(0, 4)
    : [];

  if (!povProvided) {
    return {
      ok: false,
      verdict: 'BLOCK_MISSING_POV',
      reason:
        'Pre-execution gate blocked: Do not ask the AI to invent your point of view. Supply a messy voice brain-dump (12+ words) or explicit { whatYouThink, whatWorriesYou, whatToAvoid } first.',
      requiresPushback: true,
      opposingSteelman,
      voiceCadenceAnchors: [],
    };
  }

  return {
    ok: true,
    verdict: 'ALLOW_WITH_POV',
    povSummary: {
      thesis: whatYouThink || brainDump.slice(0, 160),
      worries: whatWorriesYou || 'Extracted from voice ramble',
      antiGoals: whatToAvoid || 'Generic statistical-average AI prose',
    },
    confidencePct: confidencePct ?? 60,
    requiresPushback,
    opposingSteelman,
    voiceCadenceAnchors,
  };
}

/**
 * Phase 2 (Habit 4): Force 6 Divergent Directions (Including Cross-Domain Lenses)
 */
function generateSixDivergentAngles(topicOrThesis = '') {
  const core = String(topicOrThesis || 'system improvement').trim();
  return {
    ok: true,
    topic: core,
    note: 'First output is the statistical average. Evaluate 6 divergent domain angles before locking in a path.',
    angles: [
      {
        id: 'angle_1_game_designer',
        domainLens: 'Game Designer (Core Loop & Immediate Feedback)',
        thesis: `Treat "${core}" as a 30-second player feedback loop: strip onboarding tutorials and reward the user on their very first action.`,
        argumentFor: 'Eliminates drop-off caused by reading walls of documentation before experiencing value.',
      },
      {
        id: 'angle_2_subtraction_minimalist',
        domainLens: 'Subtraction Engineer (Delete the Step)',
        thesis: `Instead of adding UI or prompts around "${core}", delete 80% of the inputs and make the default path automatic.`,
        argumentFor: 'Reduces cognitive load and maintenance surface to near zero.',
      },
      {
        id: 'angle_3_adversarial_red_team',
        domainLens: 'Adversarial Red-Teamer (Abuse & Failure First)',
        thesis: `Assume every input to "${core}" is either malformed, sycophantic, or unverified — fail closed at the boundary.`,
        argumentFor: 'Prevents silent regressions and hallucinated state from corrupting production.',
      },
      {
        id: 'angle_4_high_frequency_trader',
        domainLens: 'Low-Latency Systems Architect (Deterministic Hot Path)',
        thesis: `Compile "${core}" into a pre-computed deterministic graph/lookup (<2ms) so zero LLM tokens burn at runtime.`,
        argumentFor: 'Slashes cost by 90%+ and makes behavior 100% repeatable.',
      },
      {
        id: 'angle_5_skeptical_buyer_cfo',
        domainLens: 'Skeptical CFO (Direct Cash & Time ROI)',
        thesis: `Frame "${core}" strictly by dollars saved or revenue booked today; cut any feature that cannot prove a 3x return.`,
        argumentFor: 'Aligns engineering directly with commercial survival.',
      },
      {
        id: 'angle_6_contrarian_inversion',
        domainLens: 'Contrarian Inversion (Opposite of Industry Consensus)',
        thesis: `Do the exact opposite of standard AI wrappers on "${core}": refuse to generate until the human supplies a 3-sentence conviction.`,
        argumentFor: 'Produces unmistakable signal in a sea of generic AI-generated noise.',
      },
    ],
  };
}

/**
 * Phase 2 (Habit 5): Early Interception Checkpoints
 * Prevents one-shot end-to-end generation before earlier checkpoints are approved.
 */
function evaluateEarlyInterceptionCheckpoint(options = {}) {
  const requestedStage = String(options.requestedStage || 'full_draft').trim();
  const approvedStages = Array.isArray(options.approvedStages)
    ? options.approvedStages
    : [];

  const targetIdx = INTERCEPTION_STAGE_ORDER.indexOf(requestedStage);
  if (targetIdx === -1) {
    return {
      ok: false,
      verdict: 'INVALID_STAGE',
      validStages: INTERCEPTION_STAGE_ORDER,
    };
  }

  const missingPriorStages = INTERCEPTION_STAGE_ORDER.slice(0, targetIdx).filter(
    (stage) => !approvedStages.includes(stage)
  );

  if (missingPriorStages.length > 0) {
    return {
      ok: false,
      verdict: 'INTERCEPT_STOP',
      requestedStage,
      missingPriorStages,
      nextRequiredCheckpoint: missingPriorStages[0],
      message: `Early Interception Gate stopped one-shot generation at "${requestedStage}". Approve low-cost checkpoint "${missingPriorStages[0]}" first to avoid sunk-cost slop.`,
    };
  }

  return {
    ok: true,
    verdict: 'CHECKPOINT_CLEARED',
    requestedStage,
    approvedStages,
  };
}

/**
 * Phase 2 (Habit 6): Multi-Persona Review Board
 * Critiques a draft from 4 specific viewpoints:
 * 1. Cold Reader
 * 2. Domain Skeptic
 * 3. Busiest Stakeholder
 * 4. Devil's Advocate (why it shouldn't ship at all)
 */
function runFourPersonaReviewBoard(draftText = '', options = {}) {
  const slop = detectSlopMarkers(draftText);
  const sentences = splitSentences(draftText);
  const hasEvidenceNumbers = /\b(\d+%|\$\d+|\d+ms|exit 0|http|file:\/\/)\b/i.test(draftText);

  const personas = [
    {
      persona: 'cold_reader',
      role: 'Cold Reader (Zero Prior Context)',
      passed: sentences.length >= 1 && slop.matchedMarkers.length === 0,
      critique:
        slop.matchedMarkers.length > 0
          ? `Found generic AI filler (${slop.matchedMarkers.join(', ')}). Replace with plain concrete nouns and verbs.`
          : 'Opening is direct and readable without insider jargon.',
    },
    {
      persona: 'domain_skeptic',
      role: 'Domain Skeptic (Demands Empirical Proof)',
      passed: hasEvidenceNumbers,
      critique: hasEvidenceNumbers
        ? 'Contains concrete metrics, URLs, or verifiable command receipts.'
        : 'Zero empirical receipts or numbers found. Anchor claims in live telemetry or test output.',
    },
    {
      persona: 'busiest_stakeholder',
      role: 'Busiest Stakeholder (5-Sentence Read Budget)',
      passed: sentences.length <= (options.maxSentences || 5),
      critique:
        sentences.length <= (options.maxSentences || 5)
          ? `Fits the read budget (${sentences.length}/${options.maxSentences || 5} sentences).`
          : `Exceeds read budget (${sentences.length} sentences vs max ${options.maxSentences || 5}). Distill to the 5-sentence bottom line.`,
    },
    {
      persona: 'devils_advocate',
      role: "Devil's Advocate (Why This Should Not Ship At All)",
      passed: slop.slopScore < 0.35 && hasEvidenceNumbers,
      critique:
        slop.slopScore >= 0.35 || !hasEvidenceNumbers
          ? 'Do not ship: this shifts cognitive burden onto the reader without new verified signal.'
          : 'Cleared to ship: carries an original point of view backed by concrete evidence.',
    },
  ];

  const allPassed = personas.every((p) => p.passed);
  return {
    ok: allPassed,
    verdict: allPassed ? 'SHIP_APPROVED' : 'REVISION_REQUIRED',
    slopAnalysis: slop,
    personas,
  };
}

/**
 * Phase 3 (Habits 7 & 9): Enforce Read Budget (<= 5 Sentences) & Raw AI Output Labeling
 */
function enforceReadBudgetAndLabelGate(text = '', options = {}) {
  const maxSentences = Number(options.maxSentences || 5);
  const isRawAiResearchDump = Boolean(options.isRawAiResearchDump);
  const raw = String(text || '').trim();
  const hasExplicitAiHeader = raw.startsWith('[AI-GENERATED');
  const sentences = splitSentences(raw);
  const slop = detectSlopMarkers(raw);

  // Habit 9: If sharing unedited AI research dump for brainstorming, require explicit label at top
  if (isRawAiResearchDump) {
    const labeledText = hasExplicitAiHeader
      ? raw
      : `${RAW_AI_DUMP_HEADER}\n\n${raw}`;
    return {
      ok: true,
      verdict: 'LABELED_RAW_AI_DUMP',
      labeledHeaderApplied: true,
      outputText: labeledText,
      sentenceCount: sentences.length,
    };
  }

  // Habit 7 & 9: Hold the gate on unread walls of text or generic AI slop
  const distilledFiveSentences = sentences.slice(0, maxSentences).join(' ');
  const withinBudget = sentences.length <= maxSentences && slop.matchedMarkers.length === 0;

  return {
    ok: withinBudget,
    verdict: withinBudget ? 'PASS_READ_BUDGET' : 'HOLD_THE_GATE_DISTILL_TO_5_SENTENCES',
    sentenceCount: sentences.length,
    maxSentences,
    matchedSlopMarkers: slop.matchedMarkers,
    distilledTake: distilledFiveSentences,
    pushbackPrompt: withinBudget
      ? null
      : `Hold the gate: This draft is ${sentences.length} sentences with ${slop.matchedMarkers.length} slop marker(s). Give me your actual take in ${maxSentences} sentences.`,
  };
}

/**
 * Phase 3 (Habit 8): Codify Taste into a Reusable Skill
 * Profiles examples of best work, admired work, and disliked work into a portable SKILL.md.
 */
function compileTasteProfileSkill(options = {}) {
  const profileName = String(options.profileName || 'operator-voice-taste')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
  const bestWork = Array.isArray(options.bestWork) ? options.bestWork : [];
  const admiredWork = Array.isArray(options.admiredWork) ? options.admiredWork : [];
  const dislikedWork = Array.isArray(options.dislikedWork) ? options.dislikedWork : [];

  const positiveCorpus = [...bestWork, ...admiredWork].join(' ');
  const positiveSentences = splitSentences(positiveCorpus);
  const avgWordsPerSentence =
    positiveSentences.length > 0
      ? Math.round(
          positiveCorpus.trim().split(/\s+/).filter(Boolean).length /
            positiveSentences.length
        )
      : 14;

  // Extract banned phrases from disliked examples
  const bannedPhrases = [];
  for (const sample of dislikedWork) {
    const detected = detectSlopMarkers(sample);
    for (const m of detected.matchedMarkers) {
      if (!bannedPhrases.includes(m.toLowerCase())) {
        bannedPhrases.push(m.toLowerCase());
      }
    }
  }
  if (bannedPhrases.length === 0) {
    bannedPhrases.push('delve into', 'it is important to note', 'in conclusion');
  }

  const skillMarkdown = [
    '---',
    `name: ${profileName}`,
    'description: Codified taste profile and anti-slop voice gate generated from operator exemplars.',
    '---',
    '',
    `# Taste & Voice Skill: ${profileName}`,
    '',
    '## Cadence & Read Budget Rules',
    `- Target sentence length: ~${avgWordsPerSentence} words per sentence.`,
    '- Hard read budget: Distill executive answers and status updates to <= 5 sentences.',
    '- Lead with the concrete verdict, metric, or receipt in sentence 1.',
    '',
    '## Banned Slop Phrases (Auto-Reject)',
    ...bannedPhrases.map((p) => `- Never use: "${p}"`),
    '',
    '## Pre-Execution & Interception Checklist',
    '1. Require a human POV brain-dump and confidence % before drafting.',
    '2. Run the 4-persona review board (Cold Reader, Domain Skeptic, Busiest Stakeholder, Devil\'s Advocate).',
    `3. Label any unedited brainstorming dump with \`${RAW_AI_DUMP_HEADER}\`.`,
    '',
  ].join('\n');

  return {
    ok: true,
    profileName,
    metrics: {
      avgWordsPerSentence,
      bannedPhrasesCount: bannedPhrases.length,
      maxReadBudgetSentences: 5,
    },
    bannedPhrases,
    skillMarkdown,
  };
}

module.exports = {
  SLOP_PATTERNS,
  RAW_AI_DUMP_HEADER,
  INTERCEPTION_STAGE_ORDER,
  splitSentences,
  detectSlopMarkers,
  evaluatePreExecutionPovGate,
  generateSixDivergentAngles,
  evaluateEarlyInterceptionCheckpoint,
  runFourPersonaReviewBoard,
  enforceReadBudgetAndLabelGate,
  compileTasteProfileSkill,
};
