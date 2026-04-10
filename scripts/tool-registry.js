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
  readOnlyTool({
    name: 'capture_feedback',
    description: 'Capture an up/down signal plus one line of why. Vague feedback is logged, then returned with a clarification prompt instead of memory promotion.',
    inputSchema: {
      type: 'object',
      required: ['signal'],
      properties: {
        signal: { type: 'string', enum: ['up', 'down'] },
        failureType: { type: 'string', enum: ['decision', 'execution'], description: 'Dual-signal: "decision" = wrong tool/action chosen, "execution" = right tool but bad parameters/output. Improves Thompson Sampling precision.' },
        context: { type: 'string', description: 'One-sentence reason describing what worked or failed' },
        relatedFeedbackId: { type: 'string', description: 'Optional prior feedback event to merge with later follow-up context.' },
        whatWentWrong: { type: 'string' },
        whatToChange: { type: 'string' },
        whatWorked: { type: 'string' },
        chatHistory: {
          type: 'array',
          description: 'Optional caller-supplied recent conversation window used for history-aware lesson distillation. The current Claude auto-capture path sends up to 8 prior recorded entries for vague negative inline signals.',
          items: {
            type: 'object',
            properties: {
              author: { type: 'string' },
              text: { type: 'string' },
              timestamp: { type: 'string' },
              source: { type: 'string' },
            },
          },
        },
        tags: { type: 'array', items: { type: 'string' } },
        skill: { type: 'string' },
        conversationWindow: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['user', 'assistant'] },
              content: { type: 'string' },
              timestamp: { type: 'string' },
            },
          },
          description: 'Recent conversation turns before the feedback signal. Raw messages, not summaries.',
        },
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
    description: 'Search promoted lessons and show the corrective actions, lifecycle state, prevention rules, gates, and next harness fixes linked to each result.',
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
    name: 'retrieve_lessons',
    description: 'Retrieve the most relevant lessons for a given tool/action context. Use in PreToolUse hooks for per-action guidance.',
    inputSchema: {
      type: 'object',
      properties: {
        toolName: { type: 'string', description: 'The tool being called (e.g., Bash, Edit, Read)' },
        actionContext: { type: 'string', description: 'Description of what the tool call is doing' },
        maxResults: { type: 'number', description: 'Max lessons to return (default 5)' },
      },
      required: ['toolName'],
    },
  }),
  readOnlyTool({
    name: 'search_thumbgate',
    description: 'Search raw ThumbGate state across feedback logs, ContextFS memory, and prevention rules.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search query for ThumbGate state.' },
        limit: { type: 'number', description: 'Maximum results to return (default 10)' },
        source: { type: 'string', enum: ['all', 'feedback', 'context', 'rules'], description: 'Restrict search to a single ThumbGate source.' },
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
    name: 'infer_lesson_from_history',
    description: 'Perform autonomous inference on chat history to identify why a failure occurred and what rule should be recorded.',
    inputSchema: {
      type: 'object',
      required: ['chatHistory'],
      properties: {
        chatHistory: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string' },
              content: { type: 'string' },
            },
          },
        },
        lastAction: { type: 'object' },
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
  readOnlyTool({
    name: 'security_scan',
    description: 'Scan code for OWASP vulnerabilities (injection, XSS, path traversal, SSRF, prototype pollution) and supply chain risks (typosquatting, install script abuse, wildcard versions). Returns findings with severity, category, and line numbers.',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string', description: 'Code content to scan' },
        filePath: { type: 'string', description: 'File path for language-aware scanning' },
        diffMode: { type: 'boolean', description: 'When true, treats content as git diff output' },
      },
    },
  }),
  readOnlyTool({
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
    name: 'export_hf_dataset',
    description: 'Export ThumbGate agent traces and DPO preference pairs as a HuggingFace-compatible dataset. Produces traces.jsonl, preferences.jsonl, and dataset_info.json with PII-redacted paths. Ready for huggingface-cli upload.',
    inputSchema: {
      type: 'object',
      properties: {
        outputDir: { type: 'string', description: 'Output directory (default: feedback-dir/hf-dataset)' },
        includeProvenance: { type: 'boolean', description: 'Include provenance events in traces (default: true)' },
      },
    },
  }),
  destructiveTool({
    name: 'export_databricks_bundle',
    description: 'Export ThumbGate logs and proof artifacts as a Databricks-ready analytics bundle',
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
  readOnlyTool({
    name: 'unified_context',
    description: 'Assemble a complete, role-aware context object in one call. Combines session state, user profile, relevant lessons, prevention guards, context pack, and code-graph impact — with tiered graceful degradation (full → warm → cold). Replaces multiple recall/retrieve/session_primer calls with a single orchestrated request.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Describe the current task to find relevant context' },
        toolName: { type: 'string', description: 'Current tool being invoked (improves lesson matching)' },
        toolInput: { type: 'object', description: 'Current tool input (for guard evaluation)' },
        agentType: { type: 'string', enum: ['claude', 'cursor', 'forgecode', 'codex'], description: 'Agent type — shapes context budget and feature inclusion' },
        repoPath: { type: 'string', description: 'Repository path for code-graph impact analysis' },
      },
    },
  }),
  destructiveTool({
    name: 'satisfy_gate',
    description: 'Satisfy a gate condition with optional structured reasoning. Evidence is stored with a 5-minute TTL. When structuredReasoning is provided, the premise/evidence/conclusion chain is stored in the audit trail.',
    inputSchema: {
      type: 'object',
      required: ['gate'],
      properties: {
        gate: { type: 'string', description: 'Gate condition ID to satisfy (e.g., pr_threads_checked)' },
        evidence: { type: 'string', description: 'Evidence text (e.g., \"0 unresolved threads\")' },
        structuredReasoning: {
          type: 'object',
          description: 'Structured pre-gate reasoning: state premises, trace evidence, assess risk, derive conclusion before unlocking.',
          properties: {
            premise: { type: 'string', description: 'What am I trying to do and why?' },
            evidence: { type: 'string', description: 'What specific, verifiable evidence supports this action?' },
            risk: { type: 'string', description: 'What could go wrong if this action proceeds?' },
            conclusion: { type: 'string', description: 'Based on evidence, should I proceed? Yes/No with justification.' },
          },
        },
      },
    },
  }),
  destructiveTool({
    name: 'set_task_scope',
    description: 'Declare or clear the current task scope so ThumbGate can compare affected files and diffs against the approved path set.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Optional stable task identifier (ticket, issue, or work item id)' },
        summary: { type: 'string', description: 'Short summary of the task being worked' },
        allowedPaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns that define the allowed file scope for this task',
        },
        protectedPaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional protected-file globs that require explicit approval before editing or publishing',
        },
        repoPath: { type: 'string', description: 'Optional repo root used when evaluating git diff scope' },
        localOnly: { type: 'boolean', description: 'When true, also marks the task as local-only' },
        clear: { type: 'boolean', description: 'Clear the current task scope instead of setting one' },
      },
    },
  }),
  readOnlyTool({
    name: 'get_scope_state',
    description: 'Return the active task scope and any unexpired protected-file approvals.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  }),
  destructiveTool({
    name: 'set_branch_governance',
    description: 'Declare or clear branch and release governance so PR, merge, release, and publish actions can be evaluated against explicit workflow state.',
    inputSchema: {
      type: 'object',
      properties: {
        branchName: { type: 'string', description: 'Optional branch name the governance applies to' },
        baseBranch: { type: 'string', description: 'Protected base branch for merge and release operations (defaults to main)' },
        prRequired: { type: 'boolean', description: 'Whether this lane must go through a pull request (defaults to true)' },
        prNumber: { type: 'string', description: 'Optional pull request number once a PR exists' },
        prUrl: { type: 'string', description: 'Optional pull request URL once a PR exists' },
        queueRequired: { type: 'boolean', description: 'Whether the target branch requires a merge queue' },
        localOnly: { type: 'boolean', description: 'When true, PR, merge, release, and publish actions are blocked for this lane' },
        releaseVersion: { type: 'string', description: 'Expected package version for release or publish actions' },
        releaseEvidence: { type: 'string', description: 'Optional evidence or release plan note for the governed version' },
        releaseSensitiveGlobs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional custom globs that define release-sensitive files for this branch lane',
        },
        clear: { type: 'boolean', description: 'Clear the current branch governance state instead of setting it' },
      },
    },
  }),
  readOnlyTool({
    name: 'get_branch_governance',
    description: 'Return the active branch and release governance state.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  }),
  destructiveTool({
    name: 'approve_protected_action',
    description: 'Grant a time-limited approval for edits or publish actions that touch protected files.',
    inputSchema: {
      type: 'object',
      required: ['pathGlobs', 'reason'],
      properties: {
        pathGlobs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Protected-file globs covered by this approval',
        },
        reason: { type: 'string', description: 'Why this protected-file action is approved' },
        evidence: { type: 'string', description: 'Optional supporting evidence or approval note' },
        taskId: { type: 'string', description: 'Optional task id this approval is tied to' },
        ttlMs: { type: 'number', description: 'Optional approval lifetime in milliseconds (defaults to 1 hour, max 24 hours)' },
      },
    },
  }),
  destructiveTool({
    name: 'track_action',
    description: 'Record a verification action in the current session (for example figma_verified or tests_passed). Session actions expire after one hour.',
    inputSchema: {
      type: 'object',
      required: ['actionId'],
      properties: {
        actionId: { type: 'string', description: 'Verification action ID to record' },
        metadata: { type: 'object', description: 'Optional structured metadata describing the evidence source' },
      },
    },
  }),
  readOnlyTool({
    name: 'verify_claim',
    description: 'Check whether a claim has enough tracked evidence before the agent asserts it.',
    inputSchema: {
      type: 'object',
      required: ['claim'],
      properties: {
        claim: { type: 'string', description: 'The claim text to verify' },
      },
    },
  }),
  readOnlyTool({
    name: 'check_operational_integrity',
    description: 'Evaluate whether the current repo state is safe for PR, merge, release, and publish operations.',
    inputSchema: {
      type: 'object',
      properties: {
        repoPath: { type: 'string', description: 'Optional repository path to inspect' },
        baseBranch: { type: 'string', description: 'Protected base branch to compare against (defaults to main)' },
        command: { type: 'string', description: 'Optional git, PR, or publish command to evaluate against the current governance state' },
        requirePrForReleaseSensitive: { type: 'boolean', description: 'When true, release-sensitive changes on non-base branches require an open PR' },
        requireVersionNotBehindBase: { type: 'boolean', description: 'When true, release-sensitive changes cannot lag behind the base branch package version' },
      },
    },
  }),
  readOnlyTool({
    name: 'workflow_sentinel',
    description: 'Predict pre-action workflow risk, blast radius, and remediations before a tool call executes.',
    inputSchema: {
      type: 'object',
      required: ['toolName'],
      properties: {
        toolName: { type: 'string', description: 'Tool being assessed, such as Bash, Edit, or Write' },
        command: { type: 'string', description: 'Optional shell command when toolName is Bash' },
        filePath: { type: 'string', description: 'Optional primary file path for edit-like tools' },
        changedFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional affected-file list used to estimate blast radius',
        },
        repoPath: { type: 'string', description: 'Optional repository path used for git-aware integrity checks' },
        baseBranch: { type: 'string', description: 'Optional protected base branch override (defaults to main)' },
        requirePrForReleaseSensitive: { type: 'boolean', description: 'When true, release-sensitive changes on non-base branches require an open PR' },
        requireVersionNotBehindBase: { type: 'boolean', description: 'When true, release-sensitive changes cannot lag behind the base branch package version' },
      },
    },
  }),
  destructiveTool({
    name: 'register_claim_gate',
    description: 'Register a custom claim verification rule in local runtime state without editing tracked repo config.',
    inputSchema: {
      type: 'object',
      required: ['claimPattern', 'requiredActions'],
      properties: {
        claimPattern: { type: 'string', description: 'Regex pattern that should trigger claim verification' },
        requiredActions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tracked actions that must be present before the claim is verified',
        },
        message: { type: 'string', description: 'Custom message returned when evidence is missing' },
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
    description: 'Get full ThumbGate dashboard -- Harness Score, gate stats, prevention impact, proof, and system health',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  }),
  readOnlyTool({
    name: 'org_dashboard',
    description: 'Org-wide multi-agent dashboard — shows all active agents, gate decisions, adherence rates, risk agents, and top blocked gates across the organization. Team rollout: full visibility. Free preview: limited to 3 agents.',
    inputSchema: {
      type: 'object',
      properties: {
        windowHours: { type: 'number', description: 'Lookback window in hours (default 24)' },
      },
    },
  }),
  readOnlyTool({
    name: 'settings_status',
    description: 'Resolve managed, user, project, and local ThumbGate settings with per-field origin metadata for policy visibility.',
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
  readOnlyTool({
    name: 'list_harnesses',
    description: 'List natural-language harness specs for portable workflow control, proof-backed verification, and GTM execution.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Optional tag filter such as verification, acquisition, or workflow.' },
      },
    },
  }),
  destructiveTool({
    name: 'run_harness',
    description: 'Execute a natural-language harness through the async job runner with checkpoints, verification, and proof-backed outcomes.',
    inputSchema: {
      type: 'object',
      required: ['harness'],
      properties: {
        harness: { type: 'string', description: 'Harness id or file basename to execute.' },
        inputs: { type: 'object', description: 'Optional input overrides for template variables.' },
        jobId: { type: 'string', description: 'Optional stable job id for the resulting runtime.' },
      },
    },
  }),
  destructiveTool({
    name: 'schedule',
    description: 'Create, list, or delete scheduled tasks. Supports natural language scheduling like "daily 9:00", "weekly monday 8:30", "hourly". Installs as macOS LaunchAgent or Linux crontab.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['create', 'list', 'delete'], description: 'Schedule action' },
        name: { type: 'string', description: 'Schedule name/ID' },
        schedule: { type: 'string', description: 'Schedule spec: "daily 9:00", "weekly monday 8:30", "hourly"' },
        command: { type: 'string', description: 'Node.js code to execute on schedule' },
        description: { type: 'string', description: 'What this schedule does' },
        workingDirectory: { type: 'string', description: 'Working directory for the command' },
      },
    },
  }),
  destructiveTool({
    name: 'user_profile',
    description: 'Manage persistent user profile — preferences, style, domain knowledge that persists across sessions. Actions: add, remove, replace, view.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['add', 'remove', 'replace', 'view'], description: 'Profile action' },
        content: { type: 'string', description: 'Content to add or new content for replace' },
        old_text: { type: 'string', description: 'Substring to match for remove/replace' },
      },
    },
  }),
  readOnlyTool({
    name: 'session_search',
    description: 'Search past session notes and conversations using full-text search. Returns relevant sessions from the SQLite FTS5 index for cross-session recall.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search query to find relevant past sessions' },
        limit: { type: 'number', description: 'Max results to return (default 10)' },
      },
    },
  }),
  destructiveTool({
    name: 'open_feedback_session',
    description: 'Open a feedback session after thumbs up/down. Follow-up messages will be captured for 60s.',
    inputSchema: {
      type: 'object',
      properties: {
        feedbackEventId: { type: 'string', description: 'The feedback event ID from capture_feedback' },
        signal: { type: 'string', enum: ['up', 'down'] },
        initialContext: { type: 'string' },
      },
      required: ['feedbackEventId', 'signal'],
    },
  }),
  destructiveTool({
    name: 'append_feedback_context',
    description: 'Append a follow-up message to an open feedback session. Call this when the user types additional context after giving thumbs up/down.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        message: { type: 'string', description: 'The follow-up message from the user' },
        role: { type: 'string', enum: ['user', 'assistant'], default: 'user' },
      },
      required: ['sessionId', 'message'],
    },
  }),
  destructiveTool({
    name: 'finalize_feedback_session',
    description: 'Finalize a feedback session and re-infer the lesson with all follow-up context.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
      },
      required: ['sessionId'],
    },
  }),
  destructiveTool({
    name: 'webhook_deliver',
    description: 'Send a message to Teams, Slack, or Discord via webhook. Use for status reports, alerts, and notifications.',
    inputSchema: {
      type: 'object',
      required: ['platform', 'webhook_url', 'title', 'message'],
      properties: {
        platform: { type: 'string', enum: ['teams', 'slack', 'discord'], description: 'Target platform' },
        webhook_url: { type: 'string', description: 'Webhook URL for the target channel' },
        title: { type: 'string', description: 'Message title' },
        message: { type: 'string', description: 'Message body (markdown supported)' },
      },
    },
  }),
  readOnlyTool({
    name: 'reflect_on_feedback',
    description: 'Run a post-mortem analysis on negative feedback. Returns a proposed rule and recurrence info.',
    inputSchema: {
      type: 'object',
      properties: {
        conversationWindow: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['user', 'assistant'] },
              content: { type: 'string' },
              timestamp: { type: 'string' },
            },
          },
          description: 'Last 5-10 conversation turns before the feedback signal.',
        },
        context: { type: 'string', description: 'One-line context from the caller' },
        whatWentWrong: { type: 'string', description: 'What the caller said went wrong' },
        feedbackEventId: { type: 'string', description: 'ID of a previously captured feedback event' },
      },
    },
  }),
  destructiveTool({
    name: 'report_product_issue',
    description: 'Report a bug, suggestion, or complaint about ThumbGate itself (not project feedback). Auto-files a GitHub issue with system context. Use when the user expresses frustration or requests a feature for the thumbgate tool.',
    inputSchema: {
      type: 'object',
      required: ['title', 'body'],
      properties: {
        title: { type: 'string', description: 'Short issue title (e.g. "Gate blocks valid migration")' },
        body: { type: 'string', description: 'Description of the problem or suggestion, in the user own words' },
        category: { type: 'string', enum: ['bug', 'feature', 'question'], description: 'Issue category' },
      },
    },
  }),
  destructiveTool({
    name: 'run_managed_lesson_agent',
    description: 'Run the LLM-powered lesson inference and rule generation agent over accumulated feedback. Requires ANTHROPIC_API_KEY for LLM mode; falls back to heuristics if unavailable.',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', description: 'Preview what would be written without persisting' },
        limit: { type: 'number', description: 'Max feedback entries to process (default: 20)' },
        model: { type: 'string', description: 'Override the Claude model (default: claude-haiku-4-5)' },
      },
    },
  }),
  readOnlyTool({
    name: 'managed_agent_status',
    description: 'Show status of the last managed lesson agent run: entries processed, lessons created, gates promoted, and total runs.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  }),
  destructiveTool({
    name: 'run_self_distill',
    description: 'Run the self-distillation agent to auto-evaluate recent agent sessions and generate improvement lessons without human feedback. Reads conversation logs, detects success/failure signals, and persists lessons.',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', description: 'If true, analyzes but does not persist lessons' },
        limit: { type: 'number', description: 'Max conversation logs to process (default 20)' },
        model: { type: 'string', description: 'LLM model to use for analysis (requires ANTHROPIC_API_KEY)' },
      },
    },
  }),
  readOnlyTool({
    name: 'self_distill_status',
    description: 'Show status of the last self-distillation run: sessions analyzed, lessons generated, signals detected.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  }),
  readOnlyTool({
    name: 'context_stuff_lessons',
    description: 'Dump ALL prevention lessons into a single text block for context-window injection. Bypasses RAG/search — returns every lesson sorted by confidence. For most projects (20-200 lessons), fits in 1K-10K tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        maxTokenBudget: { type: 'number', description: 'Approximate token budget (default: 10000)' },
        signal: { type: 'string', enum: ['positive', 'negative'], description: 'Filter by signal type' },
        format: { type: 'string', enum: ['compact', 'full'], description: 'Output format (default: compact)' },
      },
    },
  }),
];

module.exports = {
  TOOLS,
};
