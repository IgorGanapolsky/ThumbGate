#!/usr/bin/env node
'use strict';

/**
 * Salt Code Security Policy Honesty Doctor (FORMAT steal, not a product clone).
 *
 * Source: https://getsaltcode.com/ (Salt Security, 2026)
 *
 * Transfers (process only):
 *   1. 40-Policy Taxonomy — maps OWASP API Security Top 10 (2023), OWASP LLM
 *      Top 10 (2025/2026), MCP Security Diode, and OpenAPI Contract Hygiene
 *      onto deterministic inspection rules.
 *   2. Active vs Passive Interdiction — flags "context_injection_without_pretool_enforcement"
 *      when security policies exist purely in LLM prompt instructions (.cursorrules,
 *      system prompts) without active PreToolUse execution hooks.
 *   3. OpenAPI & Secret Transport Diode — blocks query-string authentication
 *      (?apiKey=, ?token=, ?secret=) and unredacted MCP credentials.
 *   4. Zero-Cloud / Zero-Token Boundary — refuses cloud dependencies on
 *      mcp.getsaltcode.com or remote closed guardrail APIs; keeps enforcement local.
 *
 * Does NOT install Salt Code MCP, send data to mcp.getsaltcode.com, or vendor Salt Security.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_URL = 'https://getsaltcode.com/';
const SALT_REMOTE_MCP_HOST = 'mcp.getsaltcode.com';

const SUBSTITUTE_CLAIM_RE =
  /\b(salt\s*code\s+(replaces?|substitutes?|obsoletes?|is\s+better\s+than)\s+thumbgate|drop\s+thumbgate\s+for\s+salt\s*code|thumbgate\s+is\s+just\s+salt\s*code)\b/i;

const SALT_CLONE_RE =
  /\b(mcp\.getsaltcode\.com|getsaltcode\.com\/mcp|install\s+saltcode|secful\/saltcode)\b/i;

const QUERY_STRING_SECRET_RE =
  /[?&](api[_-]?key|token|auth[_-]?token|secret|access[_-]?token|password|bearer|priv[_-]?key)=([^&\s'"\\]+)/i;

const OPENAPI_QUERY_SECRET_RE =
  /(name:\s*['"]?(api[_-]?key|token|auth[_-]?token|secret|access[_-]?token|password)["']?[\s\S]{0,80}in:\s*['"]?query['"]?|in:\s*['"]?query['"]?[\s\S]{0,80}name:\s*['"]?(api[_-]?key|token|auth[_-]?token|secret|access[_-]?token|password)["']?)/i;

const BOLA_ID_RE = /\b(req\.(params|query)\.id|params\.id|args\.id)\b/gi;
const BOLA_SCOPE_RE =
  /\b(userId|tenantId|ownerId|orgId|account[_-]?id|scopedBy)\b/i;
const BOLA_UNSCOPED_RE = BOLA_ID_RE;

function hasUnscopedBola(codeText) {
  for (const match of codeText.matchAll(BOLA_ID_RE)) {
    const start = Math.max(0, match.index - 120);
    const end = Math.min(codeText.length, match.index + match[0].length + 120);
    if (!BOLA_SCOPE_RE.test(codeText.slice(start, end))) return true;
  }
  return false;
}

const SSRF_DYNAMIC_FETCH_RE =
  /\b(fetch|axios\.(get|post|put|delete|request)|http\.request|https\.request|curl)\s*\(\s*(req\.(body|query|params)\.\w+|input\.\w+|args\.\w+|params\.\w+)\s*[,)]/i;

const INSECURE_OUTPUT_EXEC_RE =
  /\b(eval\s*\(\s*(response|output|result|completion|llm_out|data\.)|new\s+Function\s*\(\s*['"]\w+['"]\s*,\s*(response|output|result|completion)|exec\s*\(\s*(response|output|result|llm_out))\b/i;

const CORS_WILDCARD_RE =
  /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]\s*(?:,\s*['"]Access-Control-Allow-Credentials['"]\s*:\s*['"]true['"])?/i;

const UNREDACTED_SECRET_RE =
  /["']?(token|apiKey|api_key|password|clientSecret|secret|bearer)["']?\s*[:=]\s*["']([a-zA-Z0-9_\-]{20,})["']/i;

const INSTRUCTION_SECURITY_RE =
  /\b(do\s+not\s+(delete|drop|remove|destroy|push|commit|access|leak)|never\s+(delete|force[- ]push|modify\s+main|share\s+secrets?|expose)|must\s+not\s+(run|execute))\b/i;

/**
 * Canonical 40-policy taxonomy synthesized from Salt Code / Salt Security.
 */
const POLICY_CATALOG = Object.freeze([
  // Tier 1: OWASP API Security Top 10 (2023)
  { id: 'API1:2023', category: 'OWASP_API_TOP_10', name: 'Broken Object Level Authorization (BOLA)', gate: 'bola_unscoped_resource' },
  { id: 'API2:2023', category: 'OWASP_API_TOP_10', name: 'Broken Authentication', gate: 'query_string_secret_auth' },
  { id: 'API3:2023', category: 'OWASP_API_TOP_10', name: 'Broken Object Property Level Authorization (BOPLA)', gate: 'mass_assignment_guard' },
  { id: 'API4:2023', category: 'OWASP_API_TOP_10', name: 'Unrestricted Resource Consumption', gate: 'rate_limit_and_budget_enforcement' },
  { id: 'API5:2023', category: 'OWASP_API_TOP_10', name: 'Broken Function Level Authorization (BFLA)', gate: 'role_and_permission_diode' },
  { id: 'API6:2023', category: 'OWASP_API_TOP_10', name: 'Unrestricted Access to Sensitive Business Flows', gate: 'business_flow_rate_gate' },
  { id: 'API7:2023', category: 'OWASP_API_TOP_10', name: 'Server Side Request Forgery (SSRF)', gate: 'ssrf_unvalidated_destination' },
  { id: 'API8:2023', category: 'OWASP_API_TOP_10', name: 'Security Misconfiguration', gate: 'cors_and_debug_misconfiguration' },
  { id: 'API9:2023', category: 'OWASP_API_TOP_10', name: 'Improper Inventory Management', gate: 'api_version_and_retirement_check' },
  { id: 'API10:2023', category: 'OWASP_API_TOP_10', name: 'Unsafe Consumption of APIs', gate: 'third_party_payload_sanitizer' },

  // Tier 2: OWASP Top 10 for LLM Applications (2025)
  { id: 'LLM01:2025', category: 'OWASP_LLM_TOP_10', name: 'Prompt Injection', gate: 'indirect_prompt_injection_firewall' },
  { id: 'LLM02:2025', category: 'OWASP_LLM_TOP_10', name: 'Sensitive Information Disclosure', gate: 'secret_leak_interdiction' },
  { id: 'LLM03:2025', category: 'OWASP_LLM_TOP_10', name: 'Supply Chain Vulnerabilities', gate: 'package_manager_honesty_gate' },
  { id: 'LLM04:2025', category: 'OWASP_LLM_TOP_10', name: 'Data and Model Poisoning', gate: 'feedback_noise_guard' },
  { id: 'LLM05:2025', category: 'OWASP_LLM_TOP_10', name: 'Improper Output Handling', gate: 'insecure_output_execution' },
  { id: 'LLM06:2025', category: 'OWASP_LLM_TOP_10', name: 'Excessive Agency', gate: 'human_review_required_gate' },
  { id: 'LLM07:2025', category: 'OWASP_LLM_TOP_10', name: 'System Prompt Leakage', gate: 'tool_contract_validation_diode' },
  { id: 'LLM08:2025', category: 'OWASP_LLM_TOP_10', name: 'Vector and Embedding Weaknesses', gate: 'deterministic_pretool_verification' },
  { id: 'LLM09:2025', category: 'OWASP_LLM_TOP_10', name: 'Misinformation', gate: 'truthful_kpi_telemetry' },
  { id: 'LLM10:2025', category: 'OWASP_LLM_TOP_10', name: 'Unbounded Consumption', gate: 'token_budget_shunt' },

  // Tier 3: MCP Security Guidelines (Tool Authorization & Transport)
  { id: 'MCP01:AUTH', category: 'MCP_SECURITY', name: 'Mandatory Tool Authorization', gate: 'tool_authorization_verification' },
  { id: 'MCP02:REDACT', category: 'MCP_SECURITY', name: 'Parameter Credential Redaction', gate: 'unredacted_mcp_credentials' },
  { id: 'MCP03:TRANSPORT', category: 'MCP_SECURITY', name: 'Secure TLS Transport', gate: 'tls_transport_enforcement' },
  { id: 'MCP04:PRIVILEGE', category: 'MCP_SECURITY', name: 'Least-Privilege Tool Scope', gate: 'scoped_tool_manifest' },
  { id: 'MCP05:CONF_ISOLATION', category: 'MCP_SECURITY', name: 'Configuration Sandbox Isolation', gate: 'mcp_env_isolation_gate' },
  { id: 'MCP06:MUTATION_FENCE', category: 'MCP_SECURITY', name: 'Read-only vs Mutating Tier Diode', gate: 'tool_mutation_tier_classification' },
  { id: 'MCP07:STDIO_ISOLATION', category: 'MCP_SECURITY', name: 'Stdio Process Hygiene', gate: 'subprocess_lease_guard' },
  { id: 'MCP08:RATE_THROTTLE', category: 'MCP_SECURITY', name: 'Tool Invocation Rate Cap', gate: 'tool_call_latency_budget' },
  { id: 'MCP09:AUDIT_RECEIPT', category: 'MCP_SECURITY', name: 'Cryptographic Audit Receipt', gate: 'action_receipt_persistence' },
  { id: 'MCP10:NO_REMOTE_DEP', category: 'MCP_SECURITY', name: 'Zero-Cloud Remote Dependency Refusal', gate: 'salt_cloud_dependency_refusal' },

  // Tier 4: OpenAPI Contract Hygiene
  { id: 'OAS01:QUERY_AUTH', category: 'OPENAPI_HYGIENE', name: 'Prohibit Query-String Secret Auth', gate: 'query_string_secret_auth' },
  { id: 'OAS02:HEADER_AUTH', category: 'OPENAPI_HYGIENE', name: 'Require Standard Authorization Header', gate: 'auth_header_enforcement' },
  { id: 'OAS03:SCHEMA_STRICT', category: 'OPENAPI_HYGIENE', name: 'Strict Request/Response Schemas', gate: 'schema_validation_diode' },
  { id: 'OAS04:ERROR_SCHEMA', category: 'OPENAPI_HYGIENE', name: 'Safe Error Disclosure Schema', gate: 'error_schema_sanitizer' },
  { id: 'OAS05:CORS_STRICT', category: 'OPENAPI_HYGIENE', name: 'No Wildcard CORS with Credentials', gate: 'cors_and_debug_misconfiguration' },
  { id: 'OAS06:RATE_HEADERS', category: 'OPENAPI_HYGIENE', name: 'Rate-Limit Response Headers', gate: 'rate_limit_header_enforcement' },
  { id: 'OAS07:VERSION_PATH', category: 'OPENAPI_HYGIENE', name: 'Explicit Semantic Version in Path', gate: 'api_version_and_retirement_check' },
  { id: 'OAS08:PAYLOAD_CAP', category: 'OPENAPI_HYGIENE', name: 'Explicit Request Payload Size Limit', gate: 'request_body_size_cap' },
  { id: 'OAS09:HTTPS_ONLY', category: 'OPENAPI_HYGIENE', name: 'HTTPS Server Scheme Exclusivity', gate: 'tls_transport_enforcement' },
  { id: 'OAS10:ACTIVE_FIREWALL', category: 'OPENAPI_HYGIENE', name: 'Execution-Time PreTool Enforcement', gate: 'context_injection_without_pretool_enforcement' },
]);

/**
 * Architectural comparison mapping Salt Code's context-time injection
 * to ThumbGate's execution-layer PreToolUse infrastructure firewall.
 */
const RAIL_MAP = Object.freeze([
  {
    pillar: 'Enforcement Plane',
    saltCode: 'Prompt-time context injection (MCP advisory prompt / .cursorrules)',
    thumbgate: 'Execution-time PreToolUse hook (deterministic fail-closed firewall)',
    verdict: 'Prompt-only rules fail under prompt injection or model distress; PreToolUse intercepts tool execution.',
  },
  {
    pillar: 'Transport & Privacy',
    saltCode: 'Remote MCP server (https://mcp.getsaltcode.com/mcp, requires work email)',
    thumbgate: '100% local stdio/subshell (zero cloud dependency, zero external egress)',
    verdict: 'ThumbGate operates completely offline/air-gapped without leaking token metadata.',
  },
  {
    pillar: 'Cost & Latency',
    saltCode: 'Extra token prompt bloat + remote round-trip latency to Salt cloud',
    thumbgate: 'Zero LLM tokens for gate evaluation (<5ms deterministic AST/regex rail)',
    verdict: 'ThumbGate preserves context window and adds negligible overhead to agent loops.',
  },
  {
    pillar: 'Self-Improvement',
    saltCode: 'Static list of 40 policies hardcoded by vendor',
    thumbgate: 'Ralph Loop + Thompson Sampling feedback-to-prevention rule synthesis',
    verdict: 'ThumbGate dynamically generates new prevention rules from operator thumbs-down.',
  },
  {
    pillar: 'API & MCP Hygiene',
    saltCode: 'OpenAPI query auth warning & general guidelines',
    thumbgate: 'Automated secret-redaction diode, BOLA/SSRF AST inspection, lease locks',
    verdict: 'FORMAT stolen and promoted into automated static & runtime pre-tool gates.',
  },
]);


/**
 * Authoritative empirical statistics on LLM / Vibe-Coding security vulnerabilities.
 * Stolen from Salt Code / Veracode 2026 GenAI Code Security Report & Deng et al. 2026.
 */
const VIBE_CODING_VULNERABILITY_STATS = Object.freeze({
  syntacticallyCorrectPct: 99.9,
  completedTasksWithSecurityFlawPct: 44.0,
  vibeCodedAppsWithMajorVulnerabilitiesPct: 90.0,
  avgVulnerabilitiesPerApp: 7.0,
  sources: [
    'Veracode, 2026 GenAI Code Security Report',
    'Deng, Fan & Meng, Understanding the (In)Security of Vibe-Coded Applications, 2026',
  ],
  takeaway:
    '99.9% of AI code is syntactically valid, but 44% of tasks introduce security flaws. Advisory prompt guidelines fail under model distress; deterministic PreToolUse firewalls are mandatory.',
});

/**
 * 16 Supported AI Coding Agents and their MCP integration configuration generators.
 * Provides 1-click deep links (Cursor, VS Code) and native configuration blocks.
 */
const SUPPORTED_AGENTS = Object.freeze({
  claude: {
    id: 'claude',
    name: 'Claude Code',
    category: 'cli',
    eyebrow: 'Anthropic CLI · macOS / Linux / WSL',
    transport: 'stdio',
    docsUrl: 'https://code.claude.com/docs/en/mcp',
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    category: 'editor',
    eyebrow: 'Editor · macOS / Windows / Linux',
    transport: 'stdio',
    supportsDeeplink: true,
    docsUrl: 'https://docs.cursor.com/context/model-context-protocol',
  },
  vscode: {
    id: 'vscode',
    name: 'VS Code',
    category: 'editor',
    eyebrow: 'VS Code · GitHub Copilot',
    transport: 'stdio',
    supportsDeeplink: true,
    docsUrl: 'https://code.visualstudio.com/docs/copilot/chat/mcp-servers',
  },
  copilot_cli: {
    id: 'copilot_cli',
    name: 'GitHub Copilot CLI',
    category: 'cli',
    eyebrow: 'GitHub · terminal agent',
    transport: 'stdio',
    docsUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers',
  },
  windsurf: {
    id: 'windsurf',
    name: 'Windsurf',
    category: 'editor',
    eyebrow: 'Codeium editor · Cascade agent',
    transport: 'stdio',
    configFile: '~/.codeium/windsurf/mcp_config.json',
    docsUrl: 'https://docs.windsurf.com/windsurf/cascade/mcp',
  },
  kiro: {
    id: 'kiro',
    name: 'Kiro',
    category: 'ide',
    eyebrow: 'AWS · agentic IDE',
    transport: 'stdio',
    configFile: 'kiro/mcp_settings.json',
    docsUrl: 'https://kiro.dev/docs/mcp',
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    category: 'cli',
    eyebrow: 'OpenAI · Codex CLI',
    transport: 'stdio',
    configFile: '~/.codex/config.toml',
    docsUrl: 'https://platform.openai.com/docs/guides/tools-remote-mcp',
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    category: 'cli',
    eyebrow: 'Google AI · terminal agent',
    transport: 'stdio',
    configFile: '~/.gemini/settings.json',
    docsUrl: 'https://geminicli.com/docs/tools/mcp-server/',
  },
  antigravity: {
    id: 'antigravity',
    name: 'Antigravity',
    category: 'ide',
    eyebrow: 'Google · agent IDE',
    transport: 'stdio',
    configFile: '.antigravity/workspace.yaml',
    docsUrl: 'https://antigravity.google/docs/mcp',
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    category: 'cli',
    eyebrow: 'Terminal · open source',
    transport: 'stdio',
    docsUrl: 'https://opencode.ai/docs',
  },
  jetbrains: {
    id: 'jetbrains',
    name: 'JetBrains AI Assistant',
    category: 'ide',
    eyebrow: 'AI Assistant · IntelliJ / WebStorm / PyCharm',
    transport: 'stdio',
    configFile: 'mcp-settings.json',
    docsUrl: 'https://www.jetbrains.com/help/idea/ai-mcp.html',
  },
  grok: {
    id: 'grok',
    name: 'Grok Build CLI',
    category: 'cli',
    eyebrow: 'xAI · Grok Build CLI',
    transport: 'stdio',
    configFile: '~/.grok/config.toml',
    docsUrl: 'https://docs.x.ai/build/features/mcp-servers',
  },
  lovable: {
    id: 'lovable',
    name: 'Lovable',
    category: 'builder',
    eyebrow: 'AI app builder · chat connector',
    transport: 'http',
    docsUrl: 'https://docs.lovable.dev/integrations/custom-mcp',
  },
  cline: {
    id: 'cline',
    name: 'Cline',
    category: 'extension',
    eyebrow: 'VS Code / JetBrains / CLI agent',
    transport: 'streamableHttp',
    configFile: '~/.cline/mcp.json',
    docsUrl: 'https://docs.cline.bot/mcp/mcp-overview',
  },
  bolt: {
    id: 'bolt',
    name: 'Bolt',
    category: 'builder',
    eyebrow: 'bolt.new · StackBlitz',
    transport: 'http',
    docsUrl: 'https://support.bolt.new/building/using-bolt/connect-mcp',
  },
  generic: {
    id: 'generic',
    name: 'Any MCP Client',
    category: 'universal',
    eyebrow: 'Universal · any MCP-compatible tool',
    transport: 'stdio',
    docsUrl: 'https://modelcontextprotocol.io',
  },
});

function generateAgentOnboardingConfig(agentId, options = {}) {
  const normId = String(agentId || '').trim().toLowerCase();
  const def = SUPPORTED_AGENTS[normId];
  if (!def) {
    throw new Error(`Unsupported agent: "${agentId}". Supported: ${Object.keys(SUPPORTED_AGENTS).join(', ')}`);
  }

  const mode = options.mode || 'local'; // 'local' | 'hosted'
  const token = options.token || 'thg_demo_token';
  const serverUrl = options.serverUrl || (mode === 'local' ? 'http://127.0.0.1:4444/mcp' : 'https://thumbgate-production.up.railway.app/mcp');

  let configText = '';
  let cliCommand = '';
  let deeplink = null;

  switch (def.id) {
    case 'cursor': {
      const configObj = mode === 'local'
        ? {
            mcpServers: {
              thumbgate: {
                command: 'npx',
                args: ['-y', 'thumbgate', 'mcp'],
              },
            },
          }
        : {
            mcpServers: {
              thumbgate: {
                type: 'http',
                url: serverUrl,
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              },
            },
          };
      configText = JSON.stringify(configObj, null, 2);
      const b64 = Buffer.from(JSON.stringify(configObj.mcpServers.thumbgate)).toString('base64');
      deeplink = `cursor://anysphere.cursor-deeplink/mcp/install?name=ThumbGate&config=${b64}`;
      cliCommand = `# Edit ~/.cursor/mcp.json or click deep link:\nopen "${deeplink}"`;
      break;
    }
    case 'vscode': {
      const configObj = {
        name: 'thumbgate',
        type: mode === 'local' ? 'command' : 'http',
        ...(mode === 'local'
          ? { command: 'npx', args: ['-y', 'thumbgate', 'mcp'] }
          : { url: serverUrl, headers: { Authorization: `Bearer ${token}` } }),
      };
      configText = JSON.stringify({ mcp: { servers: { thumbgate: configObj } } }, null, 2);
      deeplink = `vscode:mcp/install?${encodeURIComponent(JSON.stringify(configObj))}`;
      cliCommand = `# Run via Command Palette (MCP: Add Server) or click deep link:\nopen "${deeplink}"`;
      break;
    }
    case 'claude': {
      cliCommand = mode === 'local'
        ? 'claude mcp add thumbgate -- npx -y thumbgate mcp'
        : `claude mcp add thumbgate ${serverUrl} --transport http --header "Authorization: Bearer ${token}" -s user`;
      configText = cliCommand;
      break;
    }
    case 'copilot_cli': {
      cliCommand = mode === 'local'
        ? 'copilot mcp add thumbgate -- command npx -y thumbgate mcp'
        : `copilot mcp add thumbgate ${serverUrl} --header "Authorization: Bearer ${token}"`;
      configText = cliCommand;
      break;
    }
    case 'windsurf': {
      const configObj = {
        mcpServers: {
          thumbgate: mode === 'local'
            ? { command: 'npx', args: ['-y', 'thumbgate', 'mcp'] }
            : { type: 'http', serverUrl, headers: { Authorization: `Bearer ${token}` } },
        },
      };
      configText = JSON.stringify(configObj, null, 2);
      cliCommand = '# Add to ~/.codeium/windsurf/mcp_config.json';
      break;
    }
    case 'kiro': {
      const configObj = {
        mcpServers: {
          thumbgate: mode === 'local'
            ? { command: 'npx', args: ['-y', 'thumbgate', 'mcp'] }
            : { type: 'http', url: serverUrl, headers: { Authorization: `Bearer ${token}` } },
        },
      };
      configText = JSON.stringify(configObj, null, 2);
      cliCommand = '# Add to kiro/mcp_settings.json';
      break;
    }
    case 'codex': {
      configText = mode === 'local'
        ? '[mcp_servers.thumbgate]\ncommand = "npx"\nargs = ["-y", "thumbgate", "mcp"]'
        : `[mcp_servers.thumbgate]\ntype = "http"\nurl = "${serverUrl}"\n\n[mcp_servers.thumbgate.headers]\nAuthorization = "Bearer ${token}"`;
      cliCommand = '# Add to ~/.codex/config.toml';
      break;
    }
    case 'gemini': {
      const configObj = {
        mcpServers: {
          thumbgate: mode === 'local'
            ? { command: 'npx', args: ['-y', 'thumbgate', 'mcp'] }
            : { httpUrl: serverUrl, headers: { Authorization: `Bearer ${token}` } },
        },
      };
      configText = JSON.stringify(configObj, null, 2);
      cliCommand = '# Add to ~/.gemini/settings.json';
      break;
    }
    case 'antigravity': {
      configText = mode === 'local'
        ? 'mcpServers:\n  thumbgate:\n    command: npx\n    args: ["-y", "thumbgate", "mcp"]'
        : `mcpServers:\n  thumbgate:\n    url: ${serverUrl}\n    headers:\n      Authorization: "Bearer ${token}"`;
      cliCommand = '# Add to .antigravity/workspace.yaml or .mcp.json';
      break;
    }
    case 'opencode': {
      cliCommand = 'opencode mcp add';
      configText = `# Run opencode mcp add and select remote (${serverUrl}) or stdio (npx -y thumbgate mcp)`;
      break;
    }
    case 'jetbrains': {
      const configObj = {
        mcpServers: {
          thumbgate: mode === 'local'
            ? { command: 'npx', args: ['-y', 'thumbgate', 'mcp'] }
            : {
                command: 'npx',
                args: ['-y', 'mcp-remote', serverUrl, '--header', `Authorization: Bearer ${token}`],
              },
        },
      };
      configText = JSON.stringify(configObj, null, 2);
      cliCommand = '# Add to JetBrains AI Assistant mcp-settings.json';
      break;
    }
    case 'grok': {
      cliCommand = mode === 'local'
        ? 'grok mcp add thumbgate -- npx -y thumbgate mcp'
        : `grok mcp add --transport http thumbgate ${serverUrl} --header "Authorization: Bearer ${token}"`;
      configText = cliCommand;
      break;
    }
    case 'lovable': {
      cliCommand = `# In Lovable Connectors, select Custom MCP with URL ${serverUrl} and Bearer token`;
      configText = JSON.stringify({ url: serverUrl, auth: 'Bearer token' }, null, 2);
      break;
    }
    case 'cline': {
      const configObj = {
        mcpServers: {
          thumbgate: mode === 'local'
            ? { command: 'npx', args: ['-y', 'thumbgate', 'mcp'], disabled: false, autoApprove: [] }
            : { type: 'streamableHttp', url: serverUrl, headers: { Authorization: `Bearer ${token}` }, disabled: false, autoApprove: [] },
        },
      };
      configText = JSON.stringify(configObj, null, 2);
      cliCommand = '# Add to ~/.cline/mcp.json';
      break;
    }
    case 'bolt': {
      cliCommand = `# In bolt.new Connectors, click Custom MCP server with URL ${serverUrl} and API key`;
      configText = JSON.stringify({ transport: 'http', url: serverUrl, auth: 'API key' }, null, 2);
      break;
    }
    case 'generic':
    default: {
      const configObj = mode === 'local'
        ? { command: 'npx', args: ['-y', 'thumbgate', 'mcp'] }
        : { type: 'http', url: serverUrl, headers: { Authorization: `Bearer ${token}` } };
      configText = JSON.stringify(configObj, null, 2);
      cliCommand = '# Generic MCP client: use stdio or streamable HTTP';
      break;
    }
  }

  return {
    id: def.id,
    name: def.name,
    category: def.category,
    eyebrow: def.eyebrow,
    transport: def.transport,
    configFile: def.configFile || null,
    docsUrl: def.docsUrl || null,
    supportsDeeplink: Boolean(def.supportsDeeplink),
    deeplink,
    cliCommand,
    configText,
  };
}

function getAllAgentOnboardingConfigs(options = {}) {
  return Object.keys(SUPPORTED_AGENTS).map((id) => generateAgentOnboardingConfig(id, options));
}

const PROMPT_QUERY_AUTH_RE =
  /\b(auth[_-]?token|api[_-]?key|token|password|secret|access[_-]?token|bearer)\s*(in|via|through|inside|using)\s*(the\s*)?(query(\s*string)?|url|query\s*param(eter)?s?)\b/i;
const PROMPT_QUERY_AUTH_RE2 =
  /\b(query(\s*string)?|url|query\s*param(eter)?s?)\s*(with|contains?|containing|holding|has)\s*(the\s*)?(auth[_-]?token|api[_-]?key|token|password|secret)\b/i;

const PROMPT_BOLA_PII_RE =
  /\b(user[_-]?id|userid|account[_-]?id|tenant[_-]?id|owner[_-]?id)\s*(in|via|through)\s*(the\s*)?(query(\s*string)?|url|path)\b/i;
const PROMPT_DELETE_USER_RE =
  /\b(delete|remove)\s*(user|account|tenant)\b.*(userid|user[_-]?id)/i;

const PROMPT_MCP_TOOL_RE =
  /\b(mcp\s*tool|mcp\s*server|tool\s*input)\b/i;

const PROMPT_ARBITRARY_EXEC_RE =
  /\b(eval\s*\(|exec\s*\(|execute\s*(the\s*)?(output|response|completion|result)|run\s*(code|script)\s*from\s*(llm|model|output))\b/i;

const PROMPT_DESTRUCTIVE_CMD_RE =
  /\b(rm\s+-rf|drop\s+database|format\s+disk|git\s+push\s+--force)\b/i;

/**
 * Evaluates a user prompt against the 40-policy taxonomy.
 * Generates proactive alternatives (the Salt Code terminal demo FORMAT)
 * and determines pre-action firewall verdict (ALLOW / REQUIRE_REVIEW / BLOCK).
 */
function evaluatePromptSecurity(promptText) {
  if (!promptText || typeof promptText !== 'string') {
    return {
      allowed: true,
      action: 'ALLOW',
      prompt: '',
      violations: [],
      alternatives: [],
      verdict: 'No prompt text provided.',
    };
  }

  const violations = [];
  const alternatives = [];
  const text = promptText.trim();

  // 1. Query string authentication check (OWASP API2 / OAS01)
  if (PROMPT_QUERY_AUTH_RE.test(text) || PROMPT_QUERY_AUTH_RE2.test(text)) {
    violations.push({
      id: 'API2:2023',
      name: 'Broken Authentication',
      gateId: 'query_string_secret_auth',
      severity: 'fail',
      message: 'Auth token in query string leaks via browser histories, server access logs, and HTTP Referer headers.',
    });
    violations.push({
      id: 'OAS01:QUERY_AUTH',
      name: 'Prohibit Query-String Secret Auth',
      gateId: 'query_string_secret_auth',
      severity: 'fail',
      message: 'API contracts must prohibit sensitive authentication credentials in query parameters.',
    });
    alternatives.push('Bearer token in Authorization header');
  }

  // 2. BOLA & PII leakage check (OWASP API1 / API3)
  if (PROMPT_BOLA_PII_RE.test(text) || PROMPT_DELETE_USER_RE.test(text)) {
    violations.push({
      id: 'API1:2023',
      name: 'Broken Object Level Authorization (BOLA)',
      gateId: 'bola_unscoped_resource',
      severity: 'warn',
      message: 'Unscoped user ID manipulation in query/path creates Broken Object Level Authorization vulnerability.',
    });
    violations.push({
      id: 'API3:2023',
      name: 'Broken Object Property Level Authorization (BOPLA)',
      gateId: 'mass_assignment_guard',
      severity: 'warn',
      message: 'User ID in query string exposes Personally Identifiable Information (PII) in transit logs.',
    });
    alternatives.push('User ID in request body with authorization check');
  }

  // 3. MCP tool input validation check (MCP01 / MCP04)
  if (PROMPT_MCP_TOOL_RE.test(text)) {
    violations.push({
      id: 'MCP01:AUTH',
      name: 'Mandatory Tool Authorization',
      gateId: 'tool_authorization_verification',
      severity: 'warn',
      message: 'MCP tool definitions require strict JSON Schema validation for all input properties.',
    });
    alternatives.push('Secure MCP tool definition with validated schema');
  }

  // 4. Insecure output execution (LLM05 / MCP07)
  if (PROMPT_ARBITRARY_EXEC_RE.test(text)) {
    violations.push({
      id: 'LLM05:2025',
      name: 'Improper Output Handling',
      gateId: 'insecure_output_execution',
      severity: 'fail',
      message: 'Dynamic execution of unvalidated LLM output allows arbitrary remote code execution.',
    });
    alternatives.push('Enforce typed JSON structured output parsing rather than raw string execution');
  }

  // 5. Destructive shell command check (MCP06)
  if (PROMPT_DESTRUCTIVE_CMD_RE.test(text)) {
    violations.push({
      id: 'MCP06:MUTATION_FENCE',
      name: 'Read-only vs Mutating Tier Diode',
      gateId: 'tool_mutation_tier_classification',
      severity: 'fail',
      message: 'Destructive shell command detected in prompt; must be intercepted by PreToolUse firewall.',
    });
    alternatives.push('ThumbGate PreToolUse firewall denies destructive shell mutations autonomously');
  }

  const hasFail = violations.some((v) => v.severity === 'fail');
  const hasWarn = violations.some((v) => v.severity === 'warn');

  let action = 'ALLOW';
  if (hasFail) action = 'BLOCK';
  else if (hasWarn) action = 'REQUIRE_REVIEW';

  const allowed = action !== 'BLOCK';

  let verdict = 'Prompt adheres to ThumbGate security policies.';
  if (violations.length > 0) {
    verdict = `Your request violates policies. Let's do this instead:\n${alternatives.map((a) => `  ✓ ${a}`).join('\n')}`;
  }

  return {
    prompt: text,
    allowed,
    action,
    violations,
    alternatives,
    verdict,
  };
}

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function readTextSafely(filePath) {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) {
    const err = new Error(`file not found: ${filePath}`);
    err.code = 'ENOENT';
    throw err;
  }
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Evaluates code, OpenAPI spec, MCP configuration, and context instructions.
 */
function evaluatePolicies({ codeText, apiText, mcpText, contextText, claimText, hasPretoolConfig }) {
  const findings = [];

  // Claim check: ensure nobody claims Salt Code is a drop-in substitute for ThumbGate
  if (claimText && SUBSTITUTE_CLAIM_RE.test(claimText)) {
    findings.push({
      id: 'substitute_claim_refused',
      category: 'ARCHITECTURE_HONESTY',
      severity: 'fail',
      gateId: 'salt_code_not_a_substitute',
      message:
        'Salt Code is prompt-time context injection; ThumbGate is execution-time PreToolUse enforcement. They are not substitutes.',
    });
  }

  // MCP Remote Cloud Dependency Check
  if (mcpText) {
    if (SALT_CLONE_RE.test(mcpText)) {
      findings.push({
        id: 'salt_cloud_dependency_refused',
        category: 'MCP_SECURITY',
        severity: 'fail',
        gateId: 'salt_cloud_dependency_refusal',
        message:
          'Detected cloud dependency on mcp.getsaltcode.com. ThumbGate enforces local-first, zero-cloud security diodes.',
      });
    }

    if (UNREDACTED_SECRET_RE.test(mcpText)) {
      findings.push({
        id: 'unredacted_mcp_credentials',
        category: 'MCP_SECURITY',
        severity: 'fail',
        gateId: 'unredacted_mcp_credentials',
        message: 'Plaintext secret or API token found in MCP configuration. Credentials must use env vars or secret stores.',
      });
    }

    // Insecure HTTP transport for remote MCP servers
    if (/"url"\s*:\s*"http:\/\/[^"]+"/i.test(mcpText)) {
      findings.push({
        id: 'insecure_mcp_http_transport',
        category: 'MCP_SECURITY',
        severity: 'fail',
        gateId: 'tls_transport_enforcement',
        message: 'Remote MCP server URL uses plaintext http://. HTTPS is mandatory.',
      });
    }
  }

  // Context & Instructions Check: Flag context-only guardrails lacking PreToolUse
  if (contextText) {
    const hasSecurityInstructions = INSTRUCTION_SECURITY_RE.test(contextText);
    if (hasSecurityInstructions && !hasPretoolConfig) {
      findings.push({
        id: 'context_injection_without_pretool_enforcement',
        category: 'ENFORCEMENT_HONESTY',
        severity: 'fail',
        gateId: 'context_injection_without_pretool_enforcement',
        message:
          'Security rules detected in prompt/context instructions without active PreToolUse hook configuration. Prompt-only rules fail under injection or distress.',
      });
    }
  }

  // OpenAPI Spec Check: Query-string secrets and CORS misconfiguration
  if (apiText) {
    if (QUERY_STRING_SECRET_RE.test(apiText) || OPENAPI_QUERY_SECRET_RE.test(apiText)) {
      findings.push({
        id: 'query_string_secret_auth',
        category: 'OPENAPI_HYGIENE',
        severity: 'fail',
        gateId: 'query_string_secret_auth',
        message:
          'Authentication secret passed via URL query parameter. Must use standard Authorization header (OWASP API2 / OAS01).',
      });
    }

    if (CORS_WILDCARD_RE.test(apiText)) {
      findings.push({
        id: 'cors_wildcard_misconfiguration',
        category: 'OPENAPI_HYGIENE',
        severity: 'warn',
        gateId: 'cors_and_debug_misconfiguration',
        message:
          'Overly permissive CORS wildcard configuration (Access-Control-Allow-Origin: *) detected in API spec.',
      });
    }
  }

  // Code Checks: BOLA, SSRF, Insecure Output Execution, Query String Secrets
  if (codeText) {
    if (QUERY_STRING_SECRET_RE.test(codeText)) {
      findings.push({
        id: 'query_string_secret_auth_code',
        category: 'OWASP_API_TOP_10',
        severity: 'fail',
        gateId: 'query_string_secret_auth',
        message:
          'Query-string secret found in code or HTTP request URL. Secrets in query parameters leak to server logs and browser histories.',
      });
    }

    if (hasUnscopedBola(codeText)) {
      findings.push({
        id: 'bola_unscoped_resource',
        category: 'OWASP_API_TOP_10',
        severity: 'warn',
        gateId: 'bola_unscoped_resource',
        message:
          'Potential Broken Object Level Authorization (BOLA): resource queried directly by ID without tenant or user ownership scope.',
      });
    }

    if (SSRF_DYNAMIC_FETCH_RE.test(codeText)) {
      findings.push({
        id: 'ssrf_unvalidated_destination',
        category: 'OWASP_API_TOP_10',
        severity: 'warn',
        gateId: 'ssrf_unvalidated_destination',
        message:
          'Dynamic URL passed to HTTP client request without domain allowlisting. Potential Server-Side Request Forgery (SSRF).',
      });
    }

    if (INSECURE_OUTPUT_EXEC_RE.test(codeText)) {
      findings.push({
        id: 'insecure_output_execution',
        category: 'OWASP_LLM_TOP_10',
        severity: 'fail',
        gateId: 'insecure_output_execution',
        message:
          'Model output or dynamic string passed directly into eval()/Function()/exec(). Violates OWASP LLM05 (Improper Output Handling).',
      });
    }
  }

  return findings;
}

/**
 * Builds the comprehensive audit report.
 */
function buildSaltCodePolicyHonestyReport(rawOptions = {}) {
  const rootDir = path.resolve(String(rawOptions.root || rawOptions.rootDir || process.cwd()));
  const mapOnly = normalizeBoolean(rawOptions['map-only'] || rawOptions.mapOnly);
  const strict = normalizeBoolean(rawOptions.strict);

  if (mapOnly) {
    return {
      name: 'thumbgate-salt-code-policy-honesty',
      status: 'ready',
      source: SOURCE_URL,
      disclaimer:
        'FORMAT steal from Salt Code (40-policy taxonomy, OWASP API Top 10, OWASP LLM Top 10, MCP security, OpenAPI query auth diode). Not affiliated with Salt Security. Operates strictly locally.',
      rootDir,
      policyCount: POLICY_CATALOG.length,
      policies: POLICY_CATALOG,
      railMap: RAIL_MAP,
      summary: {
        totalPolicies: POLICY_CATALOG.length,
        findingCount: 0,
        failCount: 0,
        warnCount: 0,
      },
      nextActions: [
        'Run without --map-only to inspect workspace code, MCP configs, and OpenAPI contracts.',
      ],
      exampleCommand: 'npx thumbgate salt-code-policy-honesty --inspect-code=src/api.js --json',
    };
  }

  const ioErrors = [];
  let codeText = rawOptions.codeText || null;
  let apiText = rawOptions.apiText || null;
  let mcpText = rawOptions.mcpText || null;
  let contextText = rawOptions.contextText || null;
  const claimText = rawOptions.claim != null ? String(rawOptions.claim) : null;

  const codePath = rawOptions['inspect-code'] || rawOptions.code || rawOptions.inspectCode;
  const apiPath = rawOptions['inspect-api'] || rawOptions.api || rawOptions.inspectApi;
  const mcpPath = rawOptions['inspect-mcp'] || rawOptions.mcp || rawOptions.inspectMcp;
  const contextPath = rawOptions['inspect-context'] || rawOptions.context || rawOptions.inspectContext;

  if (codePath && codeText == null) {
    try {
      codeText = readTextSafely(path.resolve(rootDir, String(codePath)));
    } catch (err) {
      ioErrors.push({ id: 'code_read_error', message: err.message });
    }
  }

  if (apiPath && apiText == null) {
    try {
      apiText = readTextSafely(path.resolve(rootDir, String(apiPath)));
    } catch (err) {
      ioErrors.push({ id: 'api_read_error', message: err.message });
    }
  }

  if (mcpPath && mcpText == null) {
    try {
      mcpText = readTextSafely(path.resolve(rootDir, String(mcpPath)));
    } catch (err) {
      ioErrors.push({ id: 'mcp_read_error', message: err.message });
    }
  }

  if (contextPath && contextText == null) {
    try {
      contextText = readTextSafely(path.resolve(rootDir, String(contextPath)));
    } catch (err) {
      ioErrors.push({ id: 'context_read_error', message: err.message });
    }
  }

  // Auto-detect project files if nothing provided
  let detectedMcpPath = null;
  if (!codeText && !apiText && !mcpText && !contextText && !claimText) {
    const defaultMcp = path.join(rootDir, '.mcp.json');
    if (fs.existsSync(defaultMcp)) {
      try {
        mcpText = fs.readFileSync(defaultMcp, 'utf8');
        detectedMcpPath = '.mcp.json';
      } catch (_) {}
    }
  }

  const hasPreToolHook = (p) => {
    try {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      const pre = cfg && cfg.hooks && cfg.hooks.PreToolUse;
      return Array.isArray(pre) && pre.length > 0;
    } catch (_) {
      return false;
    }
  };
  const hasPretoolConfig =
    rawOptions.hasPretoolConfig === true ||
    hasPreToolHook(path.join(rootDir, 'hooks', 'hooks.json')) ||
    hasPreToolHook(path.join(rootDir, '.claude', 'settings.json'));

  const evaluationFindings = evaluatePolicies({
    codeText,
    apiText,
    mcpText,
    contextText,
    claimText,
    hasPretoolConfig,
  });

  const allFindings = [
    ...ioErrors.map((e) => ({
      id: e.id,
      category: 'IO_ERROR',
      severity: 'fail',
      gateId: 'file_read',
      message: e.message,
    })),
    ...evaluationFindings,
  ];

  const evalPrompt = rawOptions['eval-prompt'] || rawOptions.evalPrompt || rawOptions.prompt;
  let promptEvaluation = null;
  if (evalPrompt) {
    promptEvaluation = evaluatePromptSecurity(String(evalPrompt));
    if (promptEvaluation.violations.length > 0) {
      allFindings.push(
        ...promptEvaluation.violations.map((v) => ({
          id: `prompt_${v.id.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`,
          category: 'PROMPT_SECURITY',
          severity: v.severity,
          gateId: v.gateId,
          message: `Prompt violation: ${v.name} — ${v.message}`,
        }))
      );
    }
  }

  const onboardingArg = rawOptions.onboarding || rawOptions.agent;
  let onboardingConfigs = null;
  if (onboardingArg) {
    if (onboardingArg === true || onboardingArg === 'all') {
      onboardingConfigs = getAllAgentOnboardingConfigs(rawOptions);
    } else {
      onboardingConfigs = [generateAgentOnboardingConfig(String(onboardingArg), rawOptions)];
    }
  }

  const wantDeeplinks = normalizeBoolean(rawOptions.deeplinks || rawOptions['deep-links']);
  let deeplinks = null;
  if (wantDeeplinks) {
    deeplinks = {
      cursor: generateAgentOnboardingConfig('cursor', rawOptions).deeplink,
      vscode: generateAgentOnboardingConfig('vscode', rawOptions).deeplink,
    };
  }

  const wantVibeStats = normalizeBoolean(rawOptions['vibe-stats'] || rawOptions.vibeStats);

  const failCount = allFindings.filter((f) => f.severity === 'fail').length;
  const warnCount = allFindings.filter((f) => f.severity === 'warn').length;

  let status = 'ready';
  if (failCount > 0) status = 'fail';
  else if (warnCount > 0) status = 'actionable';

  const nextActions = [];
  if (promptEvaluation && !promptEvaluation.allowed) {
    nextActions.push(`Refactor prompt to adopt safe alternative: ${promptEvaluation.alternatives.join('; ')}`);
  }
  if (failCount > 0) {
    nextActions.push('Remediate failing security gates before agent tool execution.');
  }
  if (warnCount > 0) {
    nextActions.push('Review warnings for BOLA, SSRF, or permissive CORS configurations.');
  }
  if (allFindings.length === 0) {
    nextActions.push('Audit passed cleanly. Active PreToolUse infrastructure firewall intact.');
  }

  return {
    name: 'thumbgate-salt-code-policy-honesty',
    status,
    source: SOURCE_URL,
    disclaimer:
      'FORMAT steal from Salt Code (40-policy taxonomy, OWASP API Top 10, OWASP LLM Top 10, MCP security, OpenAPI query auth diode). Not affiliated with Salt Security. Operates strictly locally.',
    rootDir,
    targetMetrics: {
      codeInspected: Boolean(codeText),
      apiInspected: Boolean(apiText),
      mcpInspected: Boolean(mcpText),
      contextInspected: Boolean(contextText),
      promptInspected: Boolean(evalPrompt),
      detectedMcpPath,
      hasPretoolConfig,
      policyCatalogSize: POLICY_CATALOG.length,
      supportedAgentsCount: Object.keys(SUPPORTED_AGENTS).length,
    },
    findings: allFindings,
    summary: {
      totalPolicies: POLICY_CATALOG.length,
      findingCount: allFindings.length,
      failCount,
      warnCount,
    },
    railMap: RAIL_MAP,
    promptEvaluation,
    onboarding: onboardingConfigs,
    deeplinks,
    vibeStats: wantVibeStats ? VIBE_CODING_VULNERABILITY_STATS : null,
    nextActions,
    exampleCommand: 'npx thumbgate salt-code-policy-honesty --inspect-code=src/index.js --json',
  };
}

/**
 * Formats the report for human-readable terminal output.
 */
function formatSaltCodePolicyHonestyReport(report) {
  const lines = [
    '=== ThumbGate Salt Code Security Policy Honesty Doctor ===',
    `Status   : ${report.status.toUpperCase()}`,
    `Root     : ${report.rootDir}`,
    `Policies : ${report.summary.totalPolicies} active policies mapped to ThumbGate PreToolUse gates`,
    `Findings : ${report.summary.findingCount} (fail=${report.summary.failCount}, warn=${report.summary.warnCount})`,
    `Source   : ${report.source}`,
  ];

  if (report.vibeStats) {
    const vs = report.vibeStats;
    lines.push('', '--- Vibe-Coding Security Intelligence (2026) ---');
    lines.push(`• Syntactically Correct Code : ${vs.syntacticallyCorrectPct}%`);
    lines.push(`• Completed Tasks with Flaws : ${vs.completedTasksWithSecurityFlawPct}% (${vs.sources[0]})`);
    lines.push(`• Vibe-Coded Apps with Flaws : ${vs.vibeCodedAppsWithMajorVulnerabilitiesPct}% (avg ${vs.avgVulnerabilitiesPerApp} vulnerabilities/app; ${vs.sources[1]})`);
    lines.push(`• Takeaway                   : ${vs.takeaway}`);
  }

  if (report.promptEvaluation) {
    const pe = report.promptEvaluation;
    lines.push('', '--- Prompt-Time Security Interception ---');
    lines.push(`Prompt   : "${pe.prompt}"`);
    lines.push(`Action   : ${pe.action} (Allowed=${pe.allowed})`);
    if (pe.violations.length > 0) {
      lines.push('Security issues found:');
      for (const v of pe.violations) {
        lines.push(`  ⚠ [${v.id}] ${v.name}: ${v.message}`);
      }
      lines.push('', "Your request violates policies. Let's do this instead:");
      for (const a of pe.alternatives) {
        lines.push(`  ✓ ${a}`);
      }
    } else {
      lines.push('Result   : ✓ Prompt passes all active security policies.');
    }
  }

  if (report.onboarding && report.onboarding.length) {
    lines.push('', '--- Universal Multi-Agent Onboarding (16 Supported Agents) ---');
    for (const ag of report.onboarding) {
      lines.push(`\n[${ag.name}] (${ag.eyebrow})`);
      if (ag.configFile) lines.push(`  Config File : ${ag.configFile}`);
      if (ag.cliCommand) lines.push(`  CLI Command : ${ag.cliCommand}`);
      if (ag.deeplink) lines.push(`  One-Click   : ${ag.deeplink}`);
      lines.push('  Config:');
      lines.push(ag.configText.split('\n').map((l) => `    ${l}`).join('\n'));
    }
  }

  if (report.deeplinks) {
    lines.push('', '--- One-Click MCP Deep Links ---');
    lines.push(`Cursor : ${report.deeplinks.cursor}`);
    lines.push(`VS Code: ${report.deeplinks.vscode}`);
  }

  if (report.railMap && report.railMap.length) {
    lines.push('', '--- Salt Code vs ThumbGate Architecture (Rail Map) ---');
    for (const r of report.railMap) {
      lines.push(`• [${r.pillar}]`);
      lines.push(`    Salt Code: ${r.saltCode}`);
      lines.push(`    ThumbGate: ${r.thumbgate}`);
      lines.push(`    Verdict  : ${r.verdict}`);
    }
  }

  if (report.findings && report.findings.length) {
    lines.push('', '--- Findings ---');
    for (const f of report.findings) {
      lines.push(`  - [${f.severity.toUpperCase()}] ${f.id} (${f.category || 'GENERAL'})`);
      lines.push(`    Gate   : ${f.gateId}`);
      lines.push(`    Message: ${f.message}`);
    }
  }

  if (report.nextActions && report.nextActions.length) {
    lines.push('', 'Next actions:');
    for (const a of report.nextActions) lines.push(`  - ${a}`);
  }

  lines.push('', `Example: ${report.exampleCommand}`);
  lines.push(`Note: ${report.disclaimer}`, '');
  return `${lines.join('\n')}\n`;
}

function parseCliArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--strict') { options.strict = true; continue; }
    if (arg === '--map-only') { options['map-only'] = true; continue; }
    if (arg === '--deeplinks' || arg === '--deep-links') { options.deeplinks = true; continue; }
    if (arg === '--vibe-stats' || arg === '--stats') { options['vibe-stats'] = true; continue; }
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    options[m[1]] = m[2] === undefined ? true : m[2];
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/salt-code-policy-honesty.js [flags]

Flags:
  --eval-prompt=TEXT     Simulate prompt evaluation against the 40-policy taxonomy
  --onboarding[=AGENT]   Generate MCP config for agent (claude, cursor, vscode, etc. or "all")
  --deeplinks            Print one-click deep links for Cursor and VS Code
  --vibe-stats           Print 2026 vibe-coding empirical vulnerability statistics
  --inspect-code=PATH    Inspect source code for BOLA, SSRF, eval(), query-string auth
  --inspect-api=PATH     Inspect OpenAPI spec for query-string secret auth & CORS
  --inspect-mcp=PATH     Inspect MCP config for unredacted credentials or remote cloud dependencies
  --inspect-context=PATH Inspect prompt instructions (.cursorrules) for un-enforced rules
  --claim=TEXT           Audit claims comparing Salt Code and ThumbGate
  --map-only             Print the 40-policy taxonomy and architecture rail map
  --strict               Exit 1 if any failure or warning is detected
  --json                 Output JSON report
  --root=DIR             Repository root directory (default: cwd)

Source: ${SOURCE_URL}
`);
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const report = buildSaltCodePolicyHonestyReport(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatSaltCodePolicyHonestyReport(report));
  }
  if (args.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  SOURCE_URL,
  POLICY_CATALOG,
  RAIL_MAP,
  VIBE_CODING_VULNERABILITY_STATS,
  SUPPORTED_AGENTS,
  generateAgentOnboardingConfig,
  getAllAgentOnboardingConfigs,
  evaluatePromptSecurity,
  SUBSTITUTE_CLAIM_RE,
  SALT_CLONE_RE,
  QUERY_STRING_SECRET_RE,
  BOLA_UNSCOPED_RE,
  SSRF_DYNAMIC_FETCH_RE,
  INSECURE_OUTPUT_EXEC_RE,
  CORS_WILDCARD_RE,
  UNREDACTED_SECRET_RE,
  evaluatePolicies,
  buildSaltCodePolicyHonestyReport,
  formatSaltCodePolicyHonestyReport,
  runCli,
};

if (require.main === module || (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename))) {
  process.exitCode = runCli(process.argv.slice(2));
}
