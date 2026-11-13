'use strict';

/**
 * ThumbGate Declarative Workflow Diode (WOML Steal)
 *
 * Adopted from Dan Kornas & Dali Ben Othmen (WOML):
 * - Workflows must be declarative and reviewable in a Git Pull Request.
 * - Source-controlled steps, policies, budget limits, and human approval gates.
 * - Fail-closed execution: stops on unverified gates or budget overruns.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Validates workflow document structure and safety constraints before execution.
 * @param {object} workflow
 */
function validateWorkflow(workflow) {
  const errors = [];
  const warnings = [];

  if (!workflow || typeof workflow !== 'object') {
    return { valid: false, errors: ['Workflow document must be a valid JSON/YAML object'] };
  }

  if (!workflow.name || typeof workflow.name !== 'string') {
    errors.push('Workflow missing required "name" string');
  }

  if (typeof workflow.budgetUsd !== 'number' || workflow.budgetUsd <= 0) {
    errors.push('Workflow missing positive "budgetUsd" limit');
  }

  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    errors.push('Workflow must define at least one step in "steps" array');
  } else {
    const stepIds = new Set();
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      if (!step.id) {
        errors.push(`Step at index ${i} is missing "id"`);
      } else if (stepIds.has(step.id)) {
        errors.push(`Duplicate step id "${step.id}"`);
      } else {
        stepIds.add(step.id);
      }

      if (!step.agent) {
        warnings.push(`Step "${step.id || i}" did not specify agent; defaulting to claude`);
      }

      if (step.destructive && !step.requireApproval) {
        errors.push(`Step "${step.id}" is marked destructive but lacks "requireApproval: true"`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Executes a validated declarative workflow with state preservation and gate checks.
 * @param {object} workflow
 * @param {object} context
 */
async function executeWorkflow(workflow, context = {}) {
  const validation = validateWorkflow(workflow);
  if (!validation.valid) {
    return {
      status: 'REJECTED_INVALID_SPEC',
      errors: validation.errors,
      completedSteps: 0,
    };
  }

  const runState = {
    workflowName: workflow.name,
    budgetUsd: workflow.budgetUsd,
    spentUsd: 0,
    stepResults: {},
    pendingApproval: null,
    status: 'IN_PROGRESS',
  };

  for (const step of workflow.steps) {
    // Check budget limit
    const estimatedCost = step.estimatedCostUsd || 0.05;
    if (runState.spentUsd + estimatedCost > runState.budgetUsd) {
      runState.status = 'BLOCKED_BUDGET_EXCEEDED';
      runState.error = `Step "${step.id}" would exceed budget limit of $${runState.budgetUsd}`;
      break;
    }

    // Check approval gate
    if (step.requireApproval && !context.approvedSteps?.includes(step.id)) {
      runState.status = 'PAUSED_AWAITING_APPROVAL';
      runState.pendingApproval = {
        stepId: step.id,
        action: step.action,
        prompt: step.prompt,
        reason: step.approvalReason || 'Step requires operator sign-off before proceeding.',
      };
      break;
    }

    // Execute step using provided runner or simulation
    const runner = context.runner || (async () => ({ ok: true, output: 'simulated success' }));
    const result = await runner(step);

    runState.spentUsd += estimatedCost;
    runState.stepResults[step.id] = {
      ok: result.ok,
      output: result.output,
      spent: estimatedCost,
    };

    if (!result.ok) {
      runState.status = 'FAILED_STEP';
      runState.failedStepId = step.id;
      break;
    }
  }

  if (runState.status === 'IN_PROGRESS') {
    runState.status = 'COMPLETED';
  }

  return runState;
}

module.exports = {
  validateWorkflow,
  executeWorkflow,
};
