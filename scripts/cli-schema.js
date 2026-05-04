'use strict';

/**
 * cli-schema.js — single source of truth for thumbgate CLI commands.
 *
 * Inspired by Cloudflare's schema-first CLI architecture: one definition
 * drives both the CLI help text and the explore TUI command browser.
 * MCP tool bindings are listed via `mcpTool` so the two surfaces stay in sync.
 *
 * Groups: capture | discovery | gates | export | ops | advanced
 */

function jsonFlag() {
  return { name: 'json', type: 'boolean', description: 'Output as JSON' };
}

function discoveryCommand({
  name,
  aliases = [],
  description,
  mcpTool,
  flags = [],
}) {
  return {
    name,
    aliases,
    description,
    group: 'discovery',
    ...(mcpTool ? { mcpTool } : {}),
    flags,
  };
}

const CLI_COMMANDS = [
  // -------------------------------------------------------------------------
  // Capture
  // -------------------------------------------------------------------------
  {
    name: 'capture',
    aliases: ['feedback'],
    description: 'Capture an up/down signal — turns feedback into a stored lesson',
    group: 'capture',
    mcpTool: 'capture_feedback',
    flags: [
      { name: 'feedback',        type: 'string',  required: true,  description: 'Signal: up or down' },
      { name: 'context',         type: 'string',  description: 'One-line reason' },
      { name: 'what-went-wrong', type: 'string',  description: 'Root cause (negative feedback)' },
      { name: 'what-to-change',  type: 'string',  description: 'Specific fix required' },
      { name: 'what-worked',     type: 'string',  description: 'What succeeded (positive feedback)' },
      { name: 'tags',            type: 'string',  description: 'Comma-separated tags' },
      { name: 'json',            type: 'boolean', description: 'Output as JSON' },
    ],
  },

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------
  {
    name: 'explore',
    description: 'Interactive TUI — browse lessons, gates, stats, and rules keyboard-first',
    group: 'discovery',
    flags: [
      { name: 'json', type: 'boolean', description: 'Output as JSON (non-interactive)' },
      { name: 'limit', type: 'number', description: 'Max items (default 20)' },
    ],
  },
  {
    name: 'lessons',
    aliases: ['search-lessons'],
    description: 'Search promoted lessons and show linked corrective actions',
    group: 'discovery',
    mcpTool: 'search_lessons',
    flags: [
      { name: 'query',    type: 'string',  description: 'Search query (positional arg also works)' },
      { name: 'limit',    type: 'number',  description: 'Max results (default 10)' },
      { name: 'tags',     type: 'string',  description: 'Comma-separated tag filter' },
      { name: 'category', type: 'string',  description: 'error | learning | preference' },
      { name: 'json',     type: 'boolean', description: 'Output as JSON' },
      { name: 'local',    type: 'boolean', description: 'Use local storage (default)' },
      { name: 'remote',   type: 'boolean', description: 'Fetch from hosted Railway instance' },
    ],
  },
  {
    name: 'stats',
    description: 'Feedback analytics — approval rate, Revenue-at-Risk, recent trend',
    group: 'discovery',
    mcpTool: 'feedback_stats',
    flags: [
      { name: 'json',   type: 'boolean', description: 'Output as JSON' },
      { name: 'remote', type: 'boolean', description: 'Fetch from hosted Railway instance' },
    ],
  },
  {
    name: 'gate-stats',
    description: 'Check engine statistics — active checks, blocks, warns, time saved',
    group: 'discovery',
    flags: [
      { name: 'json', type: 'boolean', description: 'Output as JSON' },
    ],
  },
  {
    name: 'artifacts',
    aliases: ['artifact'],
    description: 'Operator decision artifacts - PR, reliability, revenue, and release pulses',
    group: 'discovery',
    mcpTool: 'generate_operator_artifact',
    flags: [
      { name: 'type', type: 'string', description: 'pr-pulse | reliability-pulse | revenue-pulse | release-readiness' },
      { name: 'window-hours', type: 'number', description: 'Lookback window in hours (default 24)' },
      { name: 'json', type: 'boolean', description: 'Output as JSON' },
    ],
  },
  {
    name: 'summary',
    description: 'Human-readable feedback summary',
    group: 'discovery',
    mcpTool: 'feedback_summary',
    flags: [
      { name: 'recent', type: 'number', description: 'Number of recent entries (default 20)' },
      { name: 'json',   type: 'boolean', description: 'Output as JSON' },
    ],
  },
  discoveryCommand({
    name: 'doctor',
    description: 'Audit runtime isolation, bootstrap context, and permission tier',
    flags: [jsonFlag()],
  }),
  discoveryCommand({
    name: 'harness-audit',
    aliases: ['harness'],
    description: 'Score global docs, MCP discovery, and specialized check harnesses',
    flags: [
      jsonFlag(),
      { name: 'doc-token-budget', type: 'number', description: 'Global docs budget (default 9000)' },
    ],
  }),
  discoveryCommand({
    name: 'eval',
    aliases: ['prompt-eval'],
    description: 'Turn feedback into reusable prompt/workflow eval proof',
    flags: [
      jsonFlag(),
      { name: 'from-feedback', type: 'boolean', description: 'Generate eval cases from feedback-log.jsonl' },
      { name: 'feedback-log', type: 'string', description: 'Explicit feedback-log.jsonl path' },
      { name: 'feedback-dir', type: 'string', description: 'Explicit ThumbGate feedback directory' },
      { name: 'suite', type: 'string', description: 'Run an existing prompt eval suite' },
      { name: 'write-suite', type: 'string', description: 'Write generated suite JSON' },
      { name: 'write-report', type: 'string', description: 'Write Markdown proof report' },
      { name: 'min-score', type: 'number', description: 'Minimum passing score (default 80)' },
      { name: 'max-cases', type: 'number', description: 'Maximum feedback-derived cases (default 25)' },
    ],
  }),
  discoveryCommand({
    name: 'native-messaging-audit',
    aliases: ['bridge-audit'],
    description: 'Audit local browser native messaging hosts and AI browser bridges',
    mcpTool: 'native_messaging_audit',
    flags: [
      jsonFlag(),
      { name: 'platform', type: 'string', description: 'Override platform detection (darwin | linux | win32)' },
      { name: 'home-dir', type: 'string', description: 'Override home directory for manifest discovery' },
      { name: 'ai-only', type: 'boolean', description: 'Only report AI/browser bridge manifests' },
    ],
  }),
  discoveryCommand({
    name: 'code-graph-guardrails',
    aliases: ['knowledge-graph-guardrails', 'graph-guardrails'],
    description: 'Map code-graph risk signals to Knowledge Graph Safety pre-action gates',
    flags: [
      jsonFlag(),
      { name: 'graph-tool', type: 'string', description: 'Graph tool name, such as understand-anything or code-graph-mcp' },
      { name: 'graph-path', type: 'string', description: 'Path to generated graph output or cache directory' },
      { name: 'central-files', type: 'string', description: 'Comma-separated high-centrality files' },
      { name: 'layers', type: 'string', description: 'Comma-separated architecture layers touched, such as api,data,ui' },
      { name: 'generated-artifacts', type: 'string', description: 'Comma-separated generated graph artifacts to protect' },
      { name: 'changed-files', type: 'number', description: 'Estimated changed file count for blast-radius context' },
    ],
  }),
  discoveryCommand({
    name: 'proxy-pointer-rag-guardrails',
    aliases: ['document-rag-guardrails', 'multimodal-rag-guardrails'],
    description: 'Map document-tree and image-pointer RAG signals to Document RAG Safety gates',
    flags: [
      jsonFlag(),
      { name: 'rag-tool', type: 'string', description: 'RAG pipeline name, such as proxy-pointer-rag or docling-rag' },
      { name: 'tree-path', type: 'string', description: 'Path to generated document section tree JSON' },
      { name: 'section-ids', type: 'string', description: 'Comma-separated section ids included in retrieved context' },
      { name: 'image-pointers', type: 'string', description: 'Comma-separated image, chart, or figure pointers selected for the answer' },
      { name: 'documents', type: 'string', description: 'Comma-separated source document ids represented in the answer' },
      { name: 'candidate-images', type: 'number', description: 'Number of candidate images considered before final answer synthesis' },
      { name: 'cross-doc-policy', type: 'string', description: 'Set to strict when images must never cross source documents' },
      { name: 'vision-filter', type: 'boolean', description: 'Mark that a vision sanity check was used or required' },
      { name: 'visual-claims', type: 'boolean', description: 'Mark that the answer makes claims about visual content' },
    ],
  }),
  discoveryCommand({
    name: 'gemini-embedding-plan',
    aliases: ['embedding-plan'],
    description: 'Plan Gemini Embedding 2 task prefixes, Matryoshka dimensions, and Batch API indexing',
    flags: [
      jsonFlag(),
      { name: 'task', type: 'string', description: 'Retrieval task, such as code retrieval, search result, or classification' },
      { name: 'corpus-items', type: 'number', description: 'Estimated number of lessons, docs, or proof artifacts to index' },
      { name: 'dim', type: 'number', description: 'Requested output dimensionality; snaps to 3072, 1536, or 768' },
      { name: 'no-batch', type: 'boolean', description: 'Skip Batch API recommendation for online-only indexing' },
    ],
  }),
  discoveryCommand({
    name: 'agent-design-governance',
    aliases: ['agent-architecture', 'agent-governance-plan'],
    description: 'Decide single-agent vs multi-agent architecture and required eval/tool safeguards',
    mcpTool: 'plan_agent_design_governance',
    flags: [
      jsonFlag(),
      { name: 'workflow', type: 'string', description: 'Workflow name or short description' },
      { name: 'tools', type: 'string', description: 'Comma-separated tool names available to the agent' },
      { name: 'tool-count', type: 'number', description: 'Total available tools when not listing names' },
      { name: 'similar-tool-count', type: 'number', description: 'Number of similar/overlapping tools competing for selection' },
      { name: 'conditional-branches', type: 'number', description: 'Rough count of if/then instruction branches' },
      { name: 'high-risk-tools', type: 'string', description: 'Comma-separated tools that affect production, money, data, secrets, or outbound actions' },
      { name: 'write-tools', type: 'string', description: 'Comma-separated write-capable tools' },
      { name: 'baseline-evals', type: 'boolean', description: 'Whether baseline agent evals already exist' },
      { name: 'docs', type: 'boolean', description: 'Instructions draw on existing workflow docs' },
      { name: 'examples', type: 'boolean', description: 'Instructions include concrete examples' },
      { name: 'edge-cases', type: 'boolean', description: 'Instructions include edge cases and failure paths' },
      { name: 'tool-approvals', type: 'boolean', description: 'Risky tool calls require approval' },
      { name: 'exit-condition', type: 'boolean', description: 'Instructions define when the run is complete' },
    ],
  }),
  discoveryCommand({
    name: 'proactive-agent-eval-guardrails',
    aliases: ['pare-guardrails', 'proactive-agent-guardrails'],
    description: 'Map PARE-style proactive-agent eval gaps to stateful pre-action gates',
    mcpTool: 'plan_proactive_agent_eval_guardrails',
    flags: [
      jsonFlag(),
      { name: 'workflow', type: 'string', description: 'Proactive assistant workflow name' },
      { name: 'apps', type: 'string', description: 'Comma-separated apps involved in the workflow' },
      { name: 'states', type: 'string', description: 'Comma-separated app states modeled for the eval' },
      { name: 'state-count', type: 'number', description: 'Number of modeled states' },
      { name: 'action-count', type: 'number', description: 'Number of state-dependent actions' },
      { name: 'task-count', type: 'number', description: 'Number of benchmark tasks or scenarios' },
      { name: 'state-machine', type: 'boolean', description: 'Whether apps are modeled as finite state machines' },
      { name: 'active-user-simulation', type: 'boolean', description: 'Whether active user simulation exists' },
      { name: 'goal-inference-evals', type: 'boolean', description: 'Whether goal inference is graded' },
      { name: 'intervention-timing-evals', type: 'boolean', description: 'Whether intervention timing is graded' },
      { name: 'multi-app-evals', type: 'boolean', description: 'Whether multi-app orchestration is graded' },
      { name: 'flat-tool-api-only', type: 'boolean', description: 'Mark that the current eval only covers flat tool calls' },
      { name: 'proactive-writes', type: 'boolean', description: 'Mark that the proactive agent can write or mutate state' },
      { name: 'user-visible-actions', type: 'boolean', description: 'Mark that interventions can notify, schedule, send, or otherwise affect users' },
    ],
  }),
  discoveryCommand({
    name: 'rag-precision-guardrails',
    aliases: ['retrieval-precision-guardrails', 'agentic-rag-guardrails'],
    description: 'Map RAG precision tuning and retrieval-regression signals to Document RAG Safety gates',
    flags: [
      jsonFlag(),
      { name: 'rag-tool', type: 'string', description: 'RAG pipeline name, such as agentic-rag or redis-rag' },
      { name: 'baseline-recall', type: 'number', description: 'Recall@k before embedding, threshold, or reranking changes' },
      { name: 'new-recall', type: 'number', description: 'Recall@k after the proposed retrieval change' },
      { name: 'baseline-precision', type: 'number', description: 'Precision@k before the proposed retrieval change' },
      { name: 'new-precision', type: 'number', description: 'Precision@k after the proposed retrieval change' },
      { name: 'top-k', type: 'number', description: 'Retrieval k used for the baseline and candidate metrics' },
      { name: 'threshold-change', type: 'boolean', description: 'Mark that vector threshold or top-k routing changed' },
      { name: 'embedding-finetune', type: 'boolean', description: 'Mark that embedding fine-tuning or replacement is proposed' },
      { name: 'structural-near-misses', type: 'boolean', description: 'Mark that negation or role-reversal near misses matter' },
      { name: 'verifier', type: 'boolean', description: 'Mark that a second-stage verifier or reranker is present' },
      { name: 'latency-ms', type: 'number', description: 'Observed end-to-end retrieval latency after verifier or reranker' },
      { name: 'latency-budget-ms', type: 'number', description: 'Workflow retrieval latency budget' },
      { name: 'agentic', type: 'boolean', description: 'Mark that retrieval output can trigger downstream agent actions' },
    ],
  }),
  discoveryCommand({
    name: 'ai-engineering-stack-guardrails',
    aliases: ['ai-stack-guardrails', 'internal-ai-stack-guardrails', 'llm-wiki-guardrails'],
    description: 'Map AI gateway, MCP portal, AGENTS.md/LLM wiki, reviewer, and sandbox gaps to stack gates',
    flags: [
      jsonFlag(),
      { name: 'stack', type: 'string', description: 'Stack name or rollout program' },
      { name: 'gateway', type: 'boolean', description: 'Mark that a central model gateway or proxy exists' },
      { name: 'direct-provider-keys', type: 'boolean', description: 'Mark that clients still hold provider API keys directly' },
      { name: 'mcp-tool-count', type: 'number', description: 'Number of MCP tools exposed before progressive discovery' },
      { name: 'code-mode', type: 'boolean', description: 'Mark that MCP tools are hidden behind code-mode search/execute or progressive discovery' },
      { name: 'agents-md', type: 'boolean', description: 'Mark that short repo-local AGENTS.md context exists' },
      { name: 'llm-wiki-pages', type: 'number', description: 'Number of source-backed LLM wiki pages in the stack' },
      { name: 'context-freshness-days', type: 'number', description: 'Days since AGENTS.md or LLM wiki context was refreshed' },
      { name: 'ai-reviewer', type: 'boolean', description: 'Mark that risk-tiered AI code review is active' },
      { name: 'codex-rules', type: 'boolean', description: 'Mark that engineering standards are available as rules or skills' },
      { name: 'background-agents', type: 'boolean', description: 'Mark that durable/background agents can run work' },
      { name: 'sandbox', type: 'boolean', description: 'Mark that background agents run in isolated build/test sandboxes' },
      { name: 'high-risk-workflows', type: 'string', description: 'Comma-separated workflows touching money, prod, secrets, data, or publishing' },
    ],
  }),
  discoveryCommand({
    name: 'long-running-agent-context-guardrails',
    aliases: ['agent-context-guardrails', 'slack-context-guardrails'],
    description: 'Map long-running agent context risks to director-journal and critic-review gates',
    flags: [
      jsonFlag(),
      { name: 'workflow', type: 'string', description: 'Workflow or agent loop name' },
      { name: 'request-count', type: 'number', description: 'Approximate number of requests in the long-running workflow' },
      { name: 'output-mb', type: 'number', description: 'Approximate generated output volume in megabytes' },
      { name: 'director-journal', type: 'boolean', description: 'Mark that structured working memory is present' },
      { name: 'critic-review', type: 'boolean', description: 'Mark that expert findings receive critic review' },
      { name: 'critic-timeline', type: 'boolean', description: 'Mark that a deduplicated credibility timeline is present' },
      { name: 'credibility-scores', type: 'boolean', description: 'Mark that findings carry evidence credibility scores' },
      { name: 'conflicts', type: 'boolean', description: 'Mark that the timeline contains unresolved conflicting findings' },
      { name: 'raw-chat-only', type: 'boolean', description: 'Mark that the workflow only accumulates raw chat history' },
    ],
  }),
  discoveryCommand({
    name: 'reasoning-efficiency-guardrails',
    aliases: ['sas-guardrails', 'reasoning-compression-guardrails'],
    description: 'Map reasoning compression, verifier, and step-confidence signals to efficiency safety gates',
    flags: [
      jsonFlag(),
      { name: 'workload', type: 'string', description: 'Reasoning workload name' },
      { name: 'baseline-tokens', type: 'number', description: 'Average reasoning tokens before compression' },
      { name: 'compressed-tokens', type: 'number', description: 'Average reasoning tokens after compression' },
      { name: 'baseline-accuracy', type: 'number', description: 'Pass@1 or accuracy before compression' },
      { name: 'compressed-accuracy', type: 'number', description: 'Pass@1 or accuracy after compression' },
      { name: 'verifier', type: 'boolean', description: 'Mark that verifier outcomes are present' },
      { name: 'low-confidence-steps', type: 'number', description: 'Low-confidence accepted reasoning steps to inspect' },
      { name: 'high-confidence-failures', type: 'number', description: 'High-confidence failed rollouts to inspect' },
      { name: 'truncation-failures', type: 'boolean', description: 'Mark that failures may be truncation-related' },
    ],
  }),
  discoveryCommand({
    name: 'background-governance',
    aliases: ['background-agent-governance', 'agent-governance'],
    description: 'Report background-agent runs and pre-check unattended PR dispatch risk',
    flags: [
      jsonFlag(),
      { name: 'window-hours', type: 'number', description: 'Lookback window for the run report (default 24)' },
      { name: 'feedback-dir', type: 'string', description: 'Explicit ThumbGate feedback directory' },
      { name: 'check', type: 'boolean', description: 'Run a pre-dispatch governance check instead of the report' },
      { name: 'agent-id', type: 'string', description: 'Agent identifier for --check' },
      { name: 'run-type', type: 'string', description: 'Run type for --check, such as pr or ci-repair' },
      { name: 'branch', type: 'string', description: 'Target branch for --check' },
      { name: 'files-changed', type: 'number', description: 'Estimated files changed for --check' },
    ],
  }),
  discoveryCommand({
    name: 'model-candidates',
    aliases: ['managed-models'],
    description: 'Rank managed model candidates and emit benchmark plans for routed workloads',
    flags: [
      jsonFlag(),
      { name: 'workload', type: 'string', description: 'Workload id, such as pretool-gating, long-trace-review, cheap-fast-path, or dashboard-analysis' },
      { name: 'provider', type: 'string', description: 'Provider filter, such as openai, anthropic, or openai-compatible' },
      { name: 'family', type: 'string', description: 'Model family filter' },
      { name: 'gateway', type: 'string', description: 'Gateway filter for openai-compatible providers' },
      { name: 'max', type: 'number', description: 'Maximum recommendations to return (default 3)' },
    ],
  }),
  {
    name: 'lesson-health',
    aliases: ['stale'],
    description: 'Report on stale lessons (>60d inactive) with optional auto-archive',
    group: 'discovery',
    flags: [
      { name: 'archive', type: 'boolean', description: 'Auto-archive lessons >90d inactive' },
      { name: 'json',    type: 'boolean', description: 'Output as JSON' },
    ],
  },

  // -------------------------------------------------------------------------
  // Gates
  // -------------------------------------------------------------------------
  {
    name: 'gate-check',
    description: 'PreToolUse hook: pipe tool JSON via stdin, get ALLOW/BLOCK verdict',
    group: 'gates',
    flags: [],
  },
  {
    name: 'force-gate',
    description: 'Immediately create a blocking gate from a pattern string',
    group: 'gates',
    flags: [
      { name: 'pattern', type: 'string', description: 'Pattern to block (positional)' },
    ],
  },
  {
    name: 'rules',
    description: 'Generate prevention rules from repeated failure patterns',
    group: 'gates',
    mcpTool: 'prevention_rules',
    flags: [
      { name: 'json', type: 'boolean', description: 'Output as JSON' },
    ],
  },

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------
  {
    name: 'export-dpo',
    aliases: ['dpo'],
    description: 'Export DPO training pairs (prompt/chosen/rejected JSONL)',
    group: 'export',
    flags: [
      { name: 'output', type: 'string', description: 'Output file path' },
    ],
  },
  {
    name: 'export-databricks',
    aliases: ['databricks'],
    description: 'Export feedback + proof artifacts as a Databricks-ready analytics bundle',
    group: 'export',
    flags: [],
  },
  {
    name: 'obsidian-export',
    description: 'Export all feedback as interlinked Obsidian markdown notes',
    group: 'export',
    flags: [
      { name: 'vault-path',  type: 'string', description: 'Obsidian vault path' },
      { name: 'output-dir',  type: 'string', description: 'Output subdirectory (default: AI-Memories/thumbgate)' },
    ],
  },

  // -------------------------------------------------------------------------
  // Ops
  // -------------------------------------------------------------------------
  {
    name: 'status',
    description: 'Agent-friendly health check — gates, lessons, feedback, enforcement',
    group: 'discovery',
    flags: [
      { name: 'json', type: 'boolean', description: 'Output as JSON' },
    ],
  },
  {
    name: 'demo',
    description: 'Simulated walkthrough — see ThumbGate block a bad action in 10 seconds',
    group: 'ops',
    flags: [
      { name: 'json', type: 'boolean', description: 'Output as JSON' },
    ],
  },
  {
    name: 'init',
    description: 'Scaffold .thumbgate/ config and wire agent hooks',
    group: 'ops',
    flags: [
      { name: 'agent',      type: 'string',  description: 'Target agent: claude-code | cursor | codex | gemini | amp' },
      { name: 'wire-hooks', type: 'boolean', description: 'Wire hooks only (skip scaffold)' },
      { name: 'json',       type: 'boolean', description: 'Output as JSON' },
    ],
  },
  {
    name: 'serve',
    description: 'Start MCP server on stdio — connect any MCP-compatible agent',
    group: 'ops',
    flags: [],
  },
  {
    name: 'dashboard',
    description: 'Full ThumbGate dashboard — approval rate, gate stats, prevention impact',
    group: 'ops',
    flags: [],
  },
  {
    name: 'self-heal',
    description: 'Run self-healing check and auto-fix known issues',
    group: 'ops',
    flags: [
      { name: 'check', type: 'boolean', description: 'Check only, no fixes' },
    ],
  },
  {
    name: 'import-doc',
    aliases: ['import-document'],
    description: 'Import a local policy/runbook and propose reviewable gate candidates',
    group: 'ops',
    flags: [
      { name: 'file', type: 'string', description: 'Path to document' },
    ],
  },
  {
    name: 'meta-agent',
    description: 'Run meta-agent loop: generate, evaluate, and promote prevention rules',
    group: 'advanced',
    flags: [
      { name: 'dry-run', type: 'boolean', description: 'Preview rules without writing' },
      { name: 'status',  type: 'boolean', description: 'Show last run summary' },
    ],
  },
  {
    name: 'pro',
    description: `Solo dashboard + exports side lane (${'19'}/mo · ${'149'}/yr)`,
    group: 'ops',
    flags: [
      { name: 'upgrade', type: 'boolean', description: 'Install Pro configs into .thumbgate/' },
      { name: 'info',    type: 'boolean', description: 'Show Pro feature list' },
    ],
  },
];

/**
 * Return the command definition for a given name or alias.
 */
function findCommand(name) {
  return CLI_COMMANDS.find(
    (cmd) => cmd.name === name || (cmd.aliases || []).includes(name),
  );
}

/**
 * Return commands grouped by their group field.
 */
function groupedCommands() {
  const groups = {};
  for (const cmd of CLI_COMMANDS) {
    const g = cmd.group || 'other';
    if (!groups[g]) groups[g] = [];
    groups[g].push(cmd);
  }
  return groups;
}

/**
 * Generate a compact help string for a single command.
 * Format:  name [aliases]   description   [--flag ...]
 */
function commandHelpLine(cmd, opts = {}) {
  const { showFlags = false } = opts;
  const nameCol = 22;
  const nameStr = [cmd.name, ...(cmd.aliases || []).slice(0, 1)].join(' | ');
  const pad = ' '.repeat(Math.max(1, nameCol - nameStr.length));
  let line = `  ${nameStr}${pad}${cmd.description}`;
  if (cmd.mcpTool) line += ` [mcp:${cmd.mcpTool}]`;
  if (showFlags && cmd.flags.length > 0) {
    const flagStr = cmd.flags
      .map((f) => `--${f.name}${f.required ? ' (required)' : ''}`)
      .join('  ');
    line += `\n    ${flagStr}`;
  }
  return line;
}

module.exports = { CLI_COMMANDS, findCommand, groupedCommands, commandHelpLine };
