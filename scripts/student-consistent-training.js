'use strict';

function buildStudentConsistentTrainingPlan(options = {}) {
  const student = options.student || 'target-agent-policy';
  const teacher = options.teacher || 'frontier-reviewer';
  const dataset = options.dataset || 'thumbgate-feedback-lessons';
  const holdout = options.holdout || 'feedback-gate-holdout';

  return {
    method: 'student_consistent_synthetic_sft',
    dataset,
    teacher,
    student,
    generationContract: {
      teacherRole: 'adds capability tokens: corrected decision, missing evidence, safer action',
      studentRole: 'preserves target agent style: terse format, tool discipline, gate vocabulary',
      rejectIf: [
        'teacher rewrites the answer into unsupported style',
        'lesson cannot be traced to source feedback',
        'sample contains secrets or private customer context',
        'sample teaches a shortcut that bypasses evidence gates',
      ],
    },
    requiredArtifacts: [
      'source feedback id',
      'student baseline response',
      'teacher correction',
      'student-consistent final sample',
      'redaction report',
      'holdout eval result',
    ],
    evals: {
      holdout,
      compareAgainst: ['raw_teacher_sft', 'self_distill_only', 'no_training_baseline'],
      metrics: ['gate_precision', 'gate_recall', 'unsupported_claim_rate', 'style_drift_rate'],
    },
  };
}

function evaluateStudentConsistentTrainingSample(sample = {}) {
  const issues = [];

  if (!sample.sourceFeedbackId) issues.push('missing_source_feedback_id');
  if (!sample.studentBaseline) issues.push('missing_student_baseline');
  if (!sample.teacherCorrection) issues.push('missing_teacher_correction');
  if (!sample.finalSample) issues.push('missing_final_sample');
  if (!sample.redacted) issues.push('redaction_required');
  if (!sample.holdoutEval) issues.push('holdout_eval_required');

  const text = [
    sample.studentBaseline,
    sample.teacherCorrection,
    sample.finalSample,
  ].filter(Boolean).join('\n');
  if (/(api[_-]?key|secret|token|password)\s*[:=]/i.test(text)) {
    issues.push('secret_like_content');
  }

  if (sample.styleDriftRate !== undefined && Number(sample.styleDriftRate) > 0.15) {
    issues.push('style_drift_too_high');
  }

  return {
    decision: issues.length ? 'warn' : 'allow',
    issues,
    onPolicy: !issues.includes('style_drift_too_high') && Boolean(sample.studentBaseline),
  };
}

module.exports = {
  buildStudentConsistentTrainingPlan,
  evaluateStudentConsistentTrainingSample,
};
