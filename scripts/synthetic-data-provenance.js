'use strict';

function buildSyntheticDataProvenanceRecord(input = {}) {
  return {
    sampleId: input.sampleId || null,
    sourceFeedbackId: input.sourceFeedbackId || null,
    teacher: {
      model: input.teacherModel || null,
      baseModelFamily: input.teacherBaseModelFamily || null,
      promptHash: input.teacherPromptHash || null,
      riskLabel: input.teacherRiskLabel || 'unknown',
    },
    student: {
      model: input.studentModel || null,
      baseModelFamily: input.studentBaseModelFamily || null,
    },
    generation: {
      generatedAt: input.generatedAt || null,
      filterReportId: input.filterReportId || null,
      redactionReportId: input.redactionReportId || null,
      datasetVersion: input.datasetVersion || null,
    },
    evals: {
      semanticFilterPassed: Boolean(input.semanticFilterPassed),
      behavioralHoldoutPassed: Boolean(input.behavioralHoldoutPassed),
      styleDriftScore: Number.isFinite(input.styleDriftScore) ? input.styleDriftScore : null,
      hiddenTraitProbePassed: Boolean(input.hiddenTraitProbePassed),
    },
  };
}

function evaluateSyntheticDataPromotion(record = {}) {
  const issues = [];
  const teacher = record.teacher || {};
  const student = record.student || {};
  const generation = record.generation || {};
  const evals = record.evals || {};

  if (!record.sampleId) issues.push('missing_sample_id');
  if (!record.sourceFeedbackId) issues.push('missing_source_feedback_id');
  if (!teacher.model) issues.push('missing_teacher_model');
  if (!teacher.baseModelFamily) issues.push('missing_teacher_base_model_family');
  if (!student.model) issues.push('missing_student_model');
  if (!student.baseModelFamily) issues.push('missing_student_base_model_family');
  if (!generation.filterReportId) issues.push('missing_filter_report');
  if (!generation.redactionReportId) issues.push('missing_redaction_report');
  if (!generation.datasetVersion) issues.push('missing_dataset_version');
  if (!evals.semanticFilterPassed) issues.push('semantic_filter_failed_or_missing');
  if (!evals.behavioralHoldoutPassed) issues.push('behavioral_holdout_required');
  if (!evals.hiddenTraitProbePassed) issues.push('hidden_trait_probe_required');
  if (evals.styleDriftScore === null) issues.push('missing_style_drift_score');
  if (evals.styleDriftScore !== null && evals.styleDriftScore > 0.15) issues.push('style_drift_too_high');

  const sameBaseFamily = Boolean(
    teacher.baseModelFamily
    && student.baseModelFamily
    && teacher.baseModelFamily === student.baseModelFamily,
  );
  if (sameBaseFamily && teacher.riskLabel !== 'trusted') {
    issues.push('same_base_teacher_requires_trusted_risk_label');
  }

  return {
    decision: issues.length ? 'deny' : 'allow',
    issues,
    sameBaseFamily,
    riskClass: sameBaseFamily ? 'subliminal_learning_sensitive' : 'standard_distillation',
  };
}

module.exports = {
  buildSyntheticDataProvenanceRecord,
  evaluateSyntheticDataPromotion,
};
