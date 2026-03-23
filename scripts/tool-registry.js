#!/usr/bin/env node
'use strict';

function readOnlyTool(tool) {
  return {
    ...tool,
    annotations: {
      readOnlyHint: true,
    },
  };
}

function destructiveTool(tool) {
  return {
    ...tool,
    annotations: {
      destructiveHint: true,
    },
  };
}

const TOOLS = [
  destructiveTool({
    name: 'capture_feedback',
    description: 'Capture an up/down signal plus one line of why. Vague feedback is logged, then returned with a clarification prompt instead of memory promotion.',
    inputSchema: {
      type: 'object',
      required: ['signal'],
      properties: {
        signal: { type: 'string', enum: ['up', 'down'] },
        context: { type: 'string', description: 'One-sentence reason describing what worked or failed' },
        whatWentWrong: { type: 'string' },
        whatToChange: { type: 'string' },
        whatWorked: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        skill: { type: 'string' },
        rubricScores: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              criterion: { type: 'string' },
              score: { type: 'number' },
              evidence: { type: 'string' },
              judge: { type: 'string' },
            },
          },
        },
        guardrails: {
          type: 'object',
          properties: {
            testsPassed: { type: 'boolean' },
            pathSafety: { type: 'boolean' },
            budgetCompliant: { type: 'boolean' },
          },
        },
      },
    },
  }),
  readOnlyTool({
    name: 'feedback_summary',
    description: 'Get summary of recent feedback',
    inputSchema: {
      type: 'object',
      properties: {
        recent: { type: 'number' },
      },
    },
  }),
  readOnlyTool({
    name: 'search_lessons',
    description: 'Search promoted lessons and show the corrective actions, prevention rules, and gates linked to each result.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query. Leave empty to list the most recent lessons.' },
        limit: { type: 'number', description: 'Maximum results to return (default 10)' },
        category: { type: 'string', enum: ['error', 'learning', 'preference'] },
        tags: { type: 'array', items: { type: 'string' }, description: 'Require all tags to be present on a lesson' },
      },
    },
  }),
  readOnlyTool({
    name: 'search_rlhf',
    description: 'Search raw RLHF state across feedback logs, ContextFS memory, and prevention rules.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search query for RLHF state.' },
        limit: { type: 'number', description: 'Maximum results to return (default 10)' },
        source: { type: 'string', enum: ['all', 'feedback', 'context', 'rules'], description: 'Restrict search to a single RLHF source.' },
        signal: { type: 'string', enum: ['up', 'down', 'positive', 'negative'], description: 'Optional feedback-signal filter when searching feedback data.' },
      },
    },
  }),
  readOnlyTool({
    name: 'feedback_stats',
    description: 'Get feedback stats and recommendations',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  }),
  readOnlyTool({
    name: 'diagnose_failure',
    description: 'Diagnose a failed or suspect workflow step using MCP schema, workflow, gate, and approval constraints.',
    inputSchema: {
      type: 'object',
      properties: {
        step: { type: 'string' },
        context: { type: 'string' },
        toolName: { type: 'string' },
        toolArgs: { type: 'object' },
        output: { type: 'string' },
        error: { type: 'string' },
        exitCode: { type: 'number' },
        intentId: { type: 'string' },
        approved: { type: 'boolean' },
        mcpProfile: { type: 'string' },
        verification: { type: 'object' },
        rubricScores: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              criterion: { type: 'string' },
              score: { type: 'number' },
              evidence: { type: 'string' },
              judge: { type: 'string' },
            },
          },
        },
        guardrails: {
          type: 'object',
          properties: {
            testsPassed: { type: 'boolean' },
            pathSafety: { type: 'boolean' },
            budgetCompliant: { type: 'boolean' },
          },
        },
      },
    },
  }),
  readOnlyTool({
    name: 'list_intents',
    description: 'List available intent plans and whether each requires human approval in the active profile',
    inputSchema: {
      type: 'object',
      properties: {
        mcpProfile: { type: 'string' },
        bundleId: { type: 'string' },
        partnerProfile: { type: 'string' },
      },
    },
  }),
  readOnlyTool({
    name: 'plan_intent',
    description: 'Generate an intent execution plan with policy checkpoints',
    inputSchema: {
      type: 'object',
      required: ['intentId'],
      properties: {
        intentId: { type: 'string' },
        context: { type: 'string' },
        mcpProfile: { type: 'string' },
        bundleId: { type: 'string' },
        partnerProfile: { type: 'string' },
        delegationMode: { type: 'string', enum: ['off', 'auto', 'sequential'] },
        approved: { type: 'boolean' },
        repoPath: { type: 'string' },
      },
    },
  }),
  destructiveTool({
    name: 'start_handoff',
    description: 'Start a sequential delegation handoff from a delegation-eligible intent plan',
    inputSchema: {
      type: 'object',
      required: ['intentId'],
      properties: {
        intentId: { type: 'string' },
        context: { type: 'string' },
        mcpProfile: { type: 'string' },
        bundleId: { type: 'string' },
        partnerProfile: { type: 'string' },
        approved: { type: 'boolean' },
        repoPath: { type: 'string' },
        delegateProfile: { type: 'string' },
        plannedChecks: { type: 'array', items: { type: 'string' } },
      },
    },
  }),
  destructiveTool({
    name: 'complete_handoff',
    description: 'Complete a sequential delegation handoff and record verification outcomes',
    inputSchema: {
      type: 'object',
      required: ['handoffId', 'outcome'],
      properties: {
        handoffId: { type: 'string' },
        outcome: { type: 'string', enum: ['accepted', 'rejected', 'aborted'] },
        resultContext: { type: 'string' },
        attempts: { type: 'number' },
        violationCount: { type: 'number' },
        tokenEstimate: { type: 'number' },
        latencyMs: { type: 'number' },
        summary: { type: 'string' },
      },
    },
  }),
  readOnlyTool({
    name: 'describe_reliability_entity',
    description: 'Get the definition and state of a business entity (Customer, Revenue, Funnel). Aliased to describe_semantic_entity.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['Customer', 'Revenue', 'Funnel'] },
      },
    },
  }),
  readOnlyTool({
    name: 'get_reliability_rules',
    description: 'Retrieve active prevention rules and success patterns. Aliased to prevention_rules.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  }),
  readOnlyTool({
    name: 'enforcement_matrix',
    description: 'Show the full Enforcement Matrix: feedback pipeline stats, active pre-action gates, and rejection ledger with revival conditions.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  }),
  destructiveTool({
    name: 'capture_memory_feedback',
    description: 'Capture success/failure feedback to harden future workflows. Aliased to capture_feedback.',
    inputSchema: {
      type: 'object',
      properties: {
        signal: { type: 'string', enum: ['up', 'down'] },
        context: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['signal', 'context'],
    },
  }),
  destructiveTool({
    name: 'bootstrap_internal_agent',
    description: 'Normalize a GitHub/Slack/Linear trigger into startup context, construct a recall pack, prepare a git worktree sandbox, and emit an execution plus reviewer-lane plan.',
    inputSchema: {
      type: 'object',
      required: ['source'],
      properties: {
        source: { type: 'string', enum: ['github', 'slack', 'linear', 'api', 'cli'] },
        repoPath: { type: 'string' },
        prepareSandbox: { type: 'boolean' },
        sandboxRoot: { type: 'string' },
        intentId: { type: 'string' },
        context: { type: 'string' },
        mcpProfile: { type: 'string' },
        partnerProfile: { type: 'string' },
        delegationMode: { type: 'string', enum: ['off', 'auto', 'sequential'] },
        approved: { type: 'boolean' },
        trigger: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            id: { type: 'string' },
            url: { type: 'string' },
            actor: { type: 'string' },
          },
        },
        thread: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            url: { type: 'string' },
          },
        },
        task: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
            number: { type: 'string' },
            branch: { type: 'string' },
            labels: { type: 'array', items: { type: 'string' } },
          },
        },
        comments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              author: { type: 'string' },
              text: { type: 'string' },
              timestamp: { type: 'string' },
            },
          },
        },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              author: { type: 'string' },
              text: { type: 'string' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
  }),
  destructiveTool({
    name: 'prevention_rules',
    description: 'Generate prevention rules from repeated mistake patterns',
    inputSchema: {
      type: 'object',
      properties: {
        minOccurrences: { type: 'number' },
        outputPath: { type: 'string' },
      },
    },
  }),
  destructiveTool({
    name: 'export_dpo_pairs',
    description: 'Export DPO preference pairs from local memory log',
    inputSchema: {
      type: 'object',
      properties: {
        memoryLogPath: { type: 'string' },
      },
    },
  }),
  destructiveTool({
    name: 'export_databricks_bundle',
    description: 'Export RLHF logs and proof artifacts as a Databricks-ready analytics bundle',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string' },
      },
    },
  }),
  destructiveTool({
    name: 'construct_context_pack',
    description: 'Construct a bounded context pack from contextfs',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        maxItems: { type: 'number' },
        maxChars: { type: 'number' },
        namespaces: { type: 'array', items: { type: 'string' } },
      },
    },
  }),
  destructiveTool({
    name: 'evaluate_context_pack',
    description: 'Record evaluation outcome for a context pack',
    inputSchema: {
      type: 'object',
      required: ['packId', 'outcome'],
      properties: {
        packId: { type: 'string' },
        outcome: { type: 'string' },
        signal: { type: 'string' },
        notes: { type: 'string' },
        rubricScores: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              criterion: { type: 'string' },
              score: { type: 'number' },
              evidence: { type: 'string' },
              judge: { type: 'string' },
            },
          },
        },
        guardrails: {
          type: 'object',
          properties: {
            testsPassed: { type: 'boolean' },
            pathSafety: { type: 'boolean' },
            budgetCompliant: { type: 'boolean' },
          },
        },
      },
    },
  }),
  readOnlyTool({
    name: 'context_provenance',
    description: 'Get recent context/provenance events',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
    },
  }),
  destructiveTool({
    name: 'generate_skill',
    description: 'Auto-generate Claude skills from repeated feedback patterns. Clusters failure patterns by tags and produces SKILL.md files with DO/INSTEAD rules.',
    inputSchema: {
      type: 'object',
      properties: {
        minOccurrences: { type: 'number', description: 'Minimum pattern occurrences to trigger skill generation (default 3)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter to specific tags' },
      },
    },
  }),
  readOnlyTool({
    name: 'recall',
    description: 'Recall relevant past feedback, memories, and prevention rules for the current task. Call this at the start of any task to inject past learnings into the conversation.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Describe the current task or context to find relevant past feedback' },
        limit: { type: 'number', description: 'Max memories to return (default 5)' },
        repoPath: { type: 'string', description: 'Optional repository path for structural impact analysis on coding tasks' },
      },
    },
  }),
  destructiveTool({
    name: 'satisfy_gate',
    description: 'Satisfy a gate condition (e.g., after checking PR threads). Evidence is stored with a 5-minute TTL.',
    inputSchema: {
      type: 'object',
      required: ['gate'],
      properties: {
        gate: { type: 'string', description: 'Gate condition ID to satisfy (e.g., pr_threads_checked)' },
        evidence: { type: 'string', description: 'Evidence text (e.g., \"0 unresolved threads\")' },
      },
    },
  }),
  readOnlyTool({
    name: 'gate_stats',
    description: 'Get gate enforcement statistics -- blocked count, warned count, top gates',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  }),
  readOnlyTool({
    name: 'dashboard',
    description: 'Get full RLHF dashboard -- approval rate, gate stats, prevention impact, system health',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  }),
  readOnlyTool({
    name: 'commerce_recall',
    description: 'Recall past feedback filtered by commerce categories (product_recommendation, brand_compliance, sizing, pricing, regulatory). Returns quality scores alongside memories for agentic commerce agents.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Product or brand context to find relevant past feedback' },
        categories: { type: 'array', items: { type: 'string' }, description: 'Commerce categories to filter (default: all commerce categories)' },
        limit: { type: 'number', description: 'Max memories to return (default 5)' },
      },
    },
  }),
  readOnlyTool({
    name: 'get_business_metrics',
    description: 'Retrieve high-level business metrics (Revenue, Conversion, Customers) from the Semantic Layer.',
    inputSchema: {
      type: 'object',
      properties: {
        window: { type: 'string', description: 'Analytics window (today, 7d, 30d, all)' },
      },
    },
  }),
  readOnlyTool({
    name: 'describe_semantic_entity',
    description: 'Get the canonical definition and state of a business entity (Customer, Revenue, Funnel).',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['Customer', 'Revenue', 'Funnel'] },
      },
    },
  }),
  readOnlyTool({
    name: 'estimate_uncertainty',
    description: 'Estimate Bayesian uncertainty for a set of tags based on past feedback.',
    inputSchema: {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to analyze for uncertainty' },
      },
    },
  }),
  destructiveTool({
    name: 'session_handoff',
    description: 'Write a session handoff primer that auto-captures git state (branch, last 5 commits, modified files), last completed task, next step, and blockers. The next session reads this automatically for seamless context continuity.',
    inputSchema: {
      type: 'object',
      properties: {
        lastTask: { type: 'string', description: 'What was completed this session' },
        nextStep: { type: 'string', description: 'Exact next action for the next session' },
        blockers: { type: 'array', items: { type: 'string' }, description: 'Open blockers or unresolved issues' },
        openFiles: { type: 'array', items: { type: 'string' }, description: 'Key files being worked on' },
        project: { type: 'string', description: 'Project name (auto-detected from cwd if omitted)' },
        customContext: { type: 'string', description: 'Any additional context for the next session' },
      },
    },
  }),
  readOnlyTool({
    name: 'session_primer',
    description: 'Read the most recent session handoff primer to restore context from the previous session. Call at session start.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  }),
];

module.exports = {
  TOOLS,
};
