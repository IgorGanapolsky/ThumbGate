'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FAILURE_CATEGORIES,
  compileFailureConstraints,
  diagnoseFailure,
  aggregateFailureDiagnostics,
} = require('../scripts/failure-diagnostics');

test('failure diagnostics exposes expected categories', () => {
  assert.deepEqual(FAILURE_CATEGORIES, [
    'invalid_invocation',
    'tool_output_misread',
    'intent_plan_misalignment',
    'guardrail_triggered',
    'system_failure',
  ]);
});

test('compileFailureConstraints summarizes workflow, gate, and tool constraints', () => {
  const constraints = compileFailureConstraints({
    toolSchemas: [
      {
        name: 'capture_feedback',
        inputSchema: {
          required: ['signal'],
          properties: {
            signal: { type: 'string', enum: ['up', 'down'] },
          },
        },
      },
    ],
  });

  assert.ok(constraints.summary.toolSchemaCount >= 1);
  assert.ok(constraints.summary.workflowProofCommandCount >= 5);
  assert.ok(Array.isArray(constraints.gatePolicies));
});

test('diagnoseFailure classifies missing required MCP input as invalid_invocation', () => {
  const diagnosis = diagnoseFailure({
    step: 'capture_feedback',
    toolName: 'capture_feedback',
    toolArgs: {},
    toolSchemas: [
      {
        name: 'capture_feedback',
        inputSchema: {
          required: ['signal'],
          properties: {
            signal: { type: 'string', enum: ['up', 'down'] },
          },
        },
      },
    ],
    suspect: true,
  });

  assert.equal(diagnosis.rootCauseCategory, 'invalid_invocation');
  assert.ok(diagnosis.violations.some((violation) => violation.constraintId === 'tool:capture_feedback:required:signal'));
});

test('diagnoseFailure classifies approval checkpoint failures as intent_plan_misalignment', () => {
  const diagnosis = diagnoseFailure({
    step: 'plan_intent',
    context: 'Tried to publish without approval',
    intentPlan: {
      intentId: 'publish_dpo_training_data',
      requiresApproval: true,
      status: 'checkpoint_required',
      checkpoint: 'approval_required',
      approved: false,
    },
    suspect: true,
  });

  assert.equal(diagnosis.rootCauseCategory, 'intent_plan_misalignment');
  assert.equal(diagnosis.criticalFailureStep, 'plan_intent');
});

test('diagnoseFailure classifies unhealthy checks as system_failure', () => {
  const diagnosis = diagnoseFailure({
    step: 'tests',
    context: 'npm test',
    exitCode: 2,
    error: 'command failed',
    healthCheck: {
      name: 'tests',
      status: 'unhealthy',
      exitCode: 2,
      outputTail: 'test runner exploded',
    },
  });

  assert.equal(diagnosis.rootCauseCategory, 'system_failure');
  assert.ok(diagnosis.violations.some((violation) => violation.source === 'system_check'));
});

test('diagnoseFailure does not fabricate fallback diagnoses without evidence or violations', () => {
  const diagnosis = diagnoseFailure({
    step: 'feedback_capture',
    suspect: true,
  });

  assert.equal(diagnosis.diagnosed, false);
  assert.equal(diagnosis.rootCauseCategory, null);
  assert.equal(diagnosis.suspicious, true);
});

test('aggregateFailureDiagnostics groups categories and repeated constraints', () => {
  const summary = aggregateFailureDiagnostics([
    {
      diagnosis: {
        rootCauseCategory: 'guardrail_triggered',
        criticalFailureStep: 'feedback_capture',
        violations: [{ constraintId: 'rubric:verification_evidence' }],
      },
    },
    {
      diagnosis: {
        rootCauseCategory: 'guardrail_triggered',
        criticalFailureStep: 'feedback_capture',
        violations: [{ constraintId: 'rubric:verification_evidence' }],
      },
    },
  ]);

  assert.equal(summary.totalDiagnosed, 2);
  assert.equal(summary.categories[0].key, 'guardrail_triggered');
  assert.equal(summary.repeatedViolations[0].key, 'rubric:verification_evidence');
});
