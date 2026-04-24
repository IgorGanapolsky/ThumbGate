#!/usr/bin/env node
'use strict';

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeTask(task, index = 0) {
  const id = normalizeText(task && task.id) || `task-${index + 1}`;
  return {
    id,
    description: normalizeText(task && task.description),
    branchName: normalizeText(task && task.branchName) || id.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    priority: Number.isFinite(Number(task && task.priority)) ? Number(task.priority) : index + 1,
  };
}

function buildArtifactAgentPlan(input = {}) {
  const baselineName = normalizeText(input.baselineName) || 'baseline';
  const gitUrl = normalizeText(input.gitUrl) || 'https://github.com/IgorGanapolsky/ThumbGate.git';
  const tasks = Array.isArray(input.tasks) ? input.tasks.map(normalizeTask) : [];
  const forks = tasks.map((task) => ({
    taskId: task.id,
    forkName: `${baselineName}-${task.id}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
    branchName: task.branchName,
    artifactRemote: null,
    tokenRef: `artifact_token_${task.id}`,
    status: 'planned',
  }));

  return {
    generatedAt: normalizeText(input.generatedAt) || new Date().toISOString(),
    baseline: {
      name: baselineName,
      gitUrl,
      importIfMissing: true,
    },
    taskSchema: {
      required: ['id', 'description', 'branchName', 'priority'],
      properties: {
        id: 'stable task identifier',
        description: 'agent-readable task description',
        branchName: 'deterministic branch/fork suffix',
        priority: 'lower number runs first',
      },
    },
    tasks,
    forks,
    runnerContract: {
      filesystem: 'in_memory_git',
      tools: ['read(path)', 'write(path, contents)', 'run_tests(command)', 'commit(message)'],
      constraints: [
        'read before write',
        'minimize changes',
        'commit every successful task',
        'never expose artifact tokens in logs',
      ],
    },
    reviewGate: {
      requiredBeforeMerge: [
        'diff summary',
        'changed files',
        'test output',
        'decision journal entry',
        'human or reviewer-agent approval',
      ],
      blockedWithout: ['baseline comparison', 'rollback path', 'evidence artifacts'],
    },
    observability: {
      events: ['task_created', 'fork_created', 'agent_started', 'tool_call', 'commit_pushed', 'reviewed', 'merged_or_rejected'],
      metrics: ['task_latency_ms', 'tool_call_count', 'test_pass_rate', 'review_reject_rate'],
      traceKey: 'artifact_task_id',
    },
  };
}

module.exports = {
  buildArtifactAgentPlan,
  normalizeTask,
};
