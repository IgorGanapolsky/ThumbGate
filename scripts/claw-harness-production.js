'use strict';

/**
 * Claw Harness Production Readiness — ThumbGate steal of the Microsoft Agent
 * Framework "Making your claw production-ready" harness pattern
 * (devblogs.microsoft.com/agent-framework, Part 4, Wes Steyn).
 *
 * The article's four production axes, mapped onto ThumbGate claw governance:
 *
 *   1. Define once, host many. The article splits one agent factory across
 *      three thin hosts (console / hosted / evals) so every host runs the
 *      SAME agent. -> buildHarness(host): one capability manifest, three
 *      postures. No subtly different copies.
 *
 *   2. Governance screens prompts AND responses. Purview blocks disallowed
 *      content, replaces it with a policy message, and logs the interaction
 *      for audit. -> screenContent(): deterministic pattern screen over the
 *      same two directions, opt-in per host, with an append-only audit trail.
 *
 *   3. Hosted builds turn off risky capabilities. The article disables file
 *      access and shell on the hosted container (exfiltration/tampering/
 *      persistence risk, "even behind a deny-list"); file access only via an
 *      external governed store; CodeAct only inside an externally sandboxed
 *      container. -> the hosted posture encodes exactly those defaults.
 *
 *   4. Evals on every change. Local function evaluators (fast, free,
 *      CI-runnable) plus gated hosted evals; results feed the tuning loop.
 *      -> runLocalEvals(): plain-function evaluators returning
 *      { passed, total, failures }. No hosted dependency required.
 *
 * Honesty: this is deterministic policy logic. It does not run Azure,
 * Foundry, or Purview; it encodes their risk decisions as enforceable
 * manifests ThumbGate can gate on.
 */

const HOSTS = Object.freeze(['console', 'hosted', 'evals']);

const PAN_PATTERN = /\b(?:\d[ -]?){13,16}\b/;
const SECRET_PATTERNS = Object.freeze([
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: 'ghp-token', re: /\bghp_[A-Za-z0-9]{36}\b/ },
]);

/**
 * Build the capability manifest for one host posture. One definition,
 * three hosts — the article's core structural move.
 *
 * @param {string} host  console | hosted | evals
 * @param {object} opts  { fileStore?: string, codeActSandboxed?: boolean }
 */
function buildHarness(host, opts) {
  if (!HOSTS.includes(host)) {
    return { error: `unknown host "${host}" — expected one of ${HOSTS.join(', ')}` };
  }
  const o = opts || {};
  const base = {
    host,
    source: 'https://devblogs.microsoft.com/agent-framework/agent-harness-making-your-claw-production-ready/',
    telemetry: { spans: true, tokenMetrics: true, export: host === 'hosted' ? 'auto' : 'manual' },
    governance: { screenPrompts: true, screenResponses: true, audit: true },
  };

  if (host === 'hosted') {
    // The article's deliberate divergence: shell and container-disk file
    // access are OFF in a shared hosted environment.
    return {
      ...base,
      capabilities: {
        shell: false,
        fileAccess: o.fileStore ? 'external-store' : false,
        fileStore: o.fileStore || null,
        codeAct: o.codeActSandboxed ? 'sandboxed-container' : false,
        backgroundAgents: true,
      },
      notes: [
        'shell disabled on hosted posture (exfiltration/tampering/persistence risk)',
        o.fileStore
          ? 'file access allowed ONLY through the external governed store'
          : 'container-disk file access denied; supply a governed file store to enable',
        o.codeActSandboxed
          ? 'codeAct allowed: externally sandboxed container'
          : 'codeAct disabled: not externally sandboxed',
      ],
    };
  }

  if (host === 'evals') {
    return {
      ...base,
      capabilities: {
        shell: false,
        fileAccess: false,
        codeAct: false,
        backgroundAgents: false,
      },
      notes: ['evals posture: deterministic checks only; no side-effecting capabilities'],
    };
  }

  // console: the development posture — capabilities on, telemetry wired by hand
  return {
    ...base,
    capabilities: {
      shell: true,
      fileAccess: true,
      codeAct: true,
      backgroundAgents: true,
    },
    notes: ['console posture: full capabilities; wire your OTLP exporter yourself'],
  };
}

/**
 * Governance screen (the Purview analog): check one prompt or response
 * against deterministic patterns. Blocked content is replaced with a policy
 * message and the interaction is recorded for audit.
 *
 * @param {string} text
 * @param {object} ctx { direction: 'prompt'|'response', audit?: Array }
 */
function screenContent(text, ctx) {
  const direction = ctx && ctx.direction === 'response' ? 'response' : 'prompt';
  const audit = ctx && Array.isArray(ctx.audit) ? ctx.audit : null;
  const s = typeof text === 'string' ? text : '';

  let hit = null;
  if (PAN_PATTERN.test(s)) hit = { policy: 'pan', reason: 'looks like a card number' };
  if (!hit) {
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(s)) { hit = { policy: p.id, reason: 'credential pattern' }; break; }
    }
  }

  const result = hit
    ? {
      decision: 'block',
      policy: hit.policy,
      reason: hit.reason,
      replacement: '[BLOCKED BY POLICY: content screened and withheld]',
      direction,
    }
    : { decision: 'pass', direction };

  if (audit) {
    audit.push({
      at: new Date().toISOString(),
      direction,
      decision: result.decision,
      policy: hit ? hit.policy : null,
      // audit stores metadata, never the screened content itself
      chars: s.length,
    });
  }
  return result;
}

/**
 * Local evals (the article's LocalEvaluator): plain function evaluators,
 * fast, free, CI-runnable. Each evaluator gets { query, response } and
 * returns a boolean.
 */
function runLocalEvals(cases, evaluators) {
  const failures = [];
  let passed = 0;
  for (const item of cases || []) {
    for (const ev of evaluators || []) {
      const ok = Boolean(ev.fn({ query: item.query, response: item.response }));
      if (ok) passed += 1;
      else failures.push({ query: item.query, evaluator: ev.name });
    }
  }
  const total = (cases || []).length * (evaluators || []).length;
  return { passed, total, failures, passRate: total === 0 ? 1 : passed / total };
}

/**
 * Telemetry rollup (the OTel source-name idea): spans in, one summary out.
 */
function rollupTelemetry(spans) {
  const tools = new Map();
  let tokens = 0;
  for (const span of spans || []) {
    const name = span.tool || span.name || 'unknown';
    tools.set(name, (tools.get(name) || 0) + 1);
    tokens += Number(span.tokens || 0);
  }
  return {
    spanCount: (spans || []).length,
    tokensTotal: tokens,
    toolCalls: Object.fromEntries(tools),
  };
}

function isCliEntrypoint() {
  return require.main === module;
}

function main() {
  const audit = [];
  const harnesses = HOSTS.map((h) => buildHarness(h, { fileStore: 'blob://claw-files' }));
  const screens = [
    screenContent('what is my balance?', { direction: 'prompt', audit }),
    screenContent('card 4111 1111 1111 1111 on file', { direction: 'prompt', audit }),
    screenContent('use AKIAIOSFODNN7EXAMPLE for auth', { direction: 'response', audit }),
  ];
  const evals = runLocalEvals(
    [
      { query: 'Value MSFT', response: 'MSFT is valued at $3.2T' },
      { query: 'Value MSFT', response: 'I cannot say' },
      { query: 'hello', response: 'hi!' },
    ],
    [
      { name: 'numeric_valuation', fn: ({ query, response }) => !/value msft/i.test(query) || /\d/.test(response) },
    ],
  );
  const telemetry = rollupTelemetry([
    { tool: 'read_file', tokens: 120 },
    { tool: 'shell', tokens: 40 },
    { tool: 'shell', tokens: 60 },
  ]);
  process.stdout.write(JSON.stringify({
    honesty: 'deterministic policy logic; no Azure/Foundry/Purview runtime involved',
    harnesses, screens, evals, telemetry,
  }, null, 2) + '\n');
}

if (isCliEntrypoint()) main();

module.exports = {
  HOSTS,
  buildHarness,
  screenContent,
  runLocalEvals,
  rollupTelemetry,
  isCliEntrypoint,
};
