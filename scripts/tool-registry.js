#!/usr/bin/env node
'use strict';

/**
 * tool-registry.js — Central registry for MCP tool schemas.
 * 
 * Descriptions follow Anthropic Certified Architect standards:
 * - Detailed purpose and usage context.
 * - Explicit input format descriptions.
 * - Targeted FEW-SHOT EXAMPLES for ambiguous scenarios (Task Statement 4.2).
 */

const TOOLS = [
  {
    name: 'capture_feedback',
    description: 'Capture a thumbs-up (up) or thumbs-down (down) signal from the user. Use this immediately after a user provides explicit feedback on an action or output. REQUIRED: Use "up" for success/learning and "down" for mistakes/failures. Provide context describing the specific behavior being evaluated.\n\nFEW-SHOT EXAMPLES:\n1. Ambiguous Success: User says "That was fast!" while the output is missing a required field. Action: capture_feedback(signal="down", context="User praised speed but output is incomplete", whatWentWrong="Prioritized latency over schema compliance", whatToChange="Always validate full schema before returning").\n2. Clear Success: User says "Perfect, the auth flow now handles token refresh." Action: capture_feedback(signal="up", context="Implemented robust token refresh logic in auth-provider.js", whatWorked="Used an interceptor to handle 401s globally").',
    inputSchema: {
      type: 'object',
      required: ['signal'],
      properties: {
        signal: { type: 'string', enum: ['up', 'down'], description: 'The direction of feedback. "up" promotes the event to a positive memory; "down" records a mistake for future prevention.' },
        context: { type: 'string', description: 'One-sentence summary of what worked or failed.' },
        whatWentWrong: { type: 'string', description: 'For negative feedback, specify the root cause.' },
        whatToChange: { type: 'string', description: 'Actionable instruction for the next session.' },
        whatWorked: { type: 'string', description: 'For positive feedback, highlight the specific technique.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Categorical tags for cluster analysis.' },
        skill: { type: 'string' },
        rubricScores: { type: 'array', items: { type: 'object' } },
        guardrails: { type: 'object' },
      },
    },
  },
  {
    name: 'recall',
    description: 'Search past feedback, memories, and prevention rules using semantic similarity. Call this at the start of a task or when encountering a complex pattern to avoid repeating past mistakes.\n\nFEW-SHOT EXAMPLES:\n1. Problem Discovery: Encountering a bug in Stripe webhooks. Action: recall(query="handling stripe webhooks signature verification").\n2. Style Alignment: Starting a new UI component. Action: recall(query="react component styling and neon contrast conventions").',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Natural language description of the current task or problem.' },
        limit: { type: 'number', default: 5 },
        repoPath: { type: 'string' },
      },
    },
  },
  {
    name: 'feedback_summary',
    description: 'Retrieve a chronological summary of recent feedback events.',
    inputSchema: {
      type: 'object',
      properties: {
        recent: { type: 'number', default: 20 },
      },
    },
  },
  {
    name: 'feedback_stats',
    description: 'Retrieve aggregated metrics on captured feedback.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'diagnose_failure',
    description: 'Run a multi-pass diagnostic on a failed workflow step. Analyzes the failure against MCP schemas, gate policies, and intent plans.\n\nFEW-SHOT EXAMPLES:\n1. System Error: A git push failed. Action: diagnose_failure(step="git_push", error="rejected", output="main -> main (protected branch hook declined)").\n2. Tool Schema Mismatch: A tool call returned an error about missing fields. Action: diagnose_failure(toolName="capture_feedback", toolArgs={"signal": "up"}, error="missing field: context").',
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
        rubricScores: { type: 'array', items: { type: 'object' } },
        guardrails: { type: 'object' },
      },
    },
  },
  {
    name: 'list_intents',
    description: 'List available intent plans and their risk levels.',
    inputSchema: {
      type: 'object',
      properties: {
        mcpProfile: { type: 'string' },
        bundleId: { type: 'string' },
        partnerProfile: { type: 'string' },
      },
    },
  },
  {
    name: 'plan_intent',
    description: 'Generate a step-by-step execution plan for a specific intent.',
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
  },
  {
    name: 'start_handoff',
    description: 'Initiate a formal handoff to a subagent or partner instance.',
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
  },
  {
    name: 'complete_handoff',
    description: 'Record the outcome of a subagent delegation. captures success/failure, token usage, and latency.',
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
  },
  {
    name: 'prevention_rules',
    description: 'Generate a list of prevention rules derived from failure patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        minOccurrences: { type: 'number' },
        outputPath: { type: 'string' },
      },
    },
  },
  {
    name: 'construct_context_pack',
    description: 'Package relevant files, memories, and rules into a single context block.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        maxItems: { type: 'number', default: 8 },
        maxChars: { type: 'number', default: 6000 },
        namespaces: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'evaluate_context_pack',
    description: 'Record the utility of a context pack.',
    inputSchema: {
      type: 'object',
      required: ['packId', 'outcome'],
      properties: {
        packId: { type: 'string' },
        outcome: { type: 'string', enum: ['up', 'down'] },
        signal: { type: 'string' },
        notes: { type: 'string' },
        rubricScores: { type: 'array', items: { type: 'object' } },
        guardrails: { type: 'object' },
      },
    },
  },
  {
    name: 'context_provenance',
    description: 'Retrieve recent context/provenance events.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 50 },
      },
    },
  },
  {
    name: 'commerce_recall',
    description: 'Recall past feedback filtered by commerce categories (product_recommendation, brand_compliance, sizing, pricing, regulatory). Returns quality scores alongside memories for agentic commerce agents.\n\nFEW-SHOT EXAMPLES:\n1. Compliance Check: Validating if a product description follows brand guidelines. Action: commerce_recall(query="brand compliance for neon colors", categories=["brand_compliance"]).\n2. Pricing Strategy: Researching past user reactions to price changes. Action: commerce_recall(query="price sensitivity for starter packs", categories=["pricing"]).',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Product or brand context to find relevant past feedback.' },
        categories: { type: 'array', items: { type: 'string' }, description: 'Commerce categories to filter (default: all commerce categories).' },
        limit: { type: 'number', default: 5, description: 'Max memories to return.' },
      },
    },
  },
  {
    name: 'generate_skill',
    description: 'Synthesize a formal SKILL.md file from clusters of feedback.',
    inputSchema: {
      type: 'object',
      properties: {
        minOccurrences: { type: 'number', default: 3 },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'satisfy_gate',
    description: 'Programmatically satisfy a blocking pre-action gate.',
    inputSchema: {
      type: 'object',
      required: ['gate'],
      properties: {
        gate: { type: 'string' },
        evidence: { type: 'string' },
      },
    },
  },
  {
    name: 'estimate_uncertainty',
    description: 'Perform a Bayesian estimation of uncertainty for a set of tags.',
    inputSchema: {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'update_scratchpad',
    description: 'Persist key findings, architectural decisions, or state across context boundaries. Use this to counteract context degradation in long sessions by recording "case facts" that should survive summarization.\n\nFEW-SHOT EXAMPLES:\n1. Architectural Decision: Deciding on a database schema. Action: update_scratchpad(title="db_schema_final", content="Users table: id, email, hashed_password; Orders table: id, user_id, amount").\n2. Task State: Recording progress during a multi-file migration. Action: update_scratchpad(title="migration_progress", content="Finished: auth.js, api.js; Pending: types.ts, README.md").',
    inputSchema: {
      type: 'object',
      required: ['title', 'content'],
      properties: {
        title: { type: 'string', description: 'A short, unique slug for the finding (e.g., "auth_logic_flow").' },
        content: { type: 'string', description: 'The detailed finding or state to persist.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for categorical retrieval.' },
      },
    },
  },
];

module.exports = {
  TOOLS,
};
