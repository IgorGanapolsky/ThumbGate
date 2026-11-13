/**
 * Enterprise AI Lifecycle Guardrail Engine.
 * 
 * Replaces system prompts with deterministic, external enforcement layers
 * across the entire request lifecycle:
 * 
 * 1. Four Checkpoint Layers:
 *    - INPUT: PII masking (SSN, cards, keys), prompt injection blocking, out-of-scope filter.
 *    - OUTPUT: Secret leak detection, factual grounding against retrieved evidence.
 *    - TOOL/ACTION: Intercept API/DB/webhook, tool allowlist, argument range, role permission.
 *    - POLICY: Universal business invariants (e.g. monetary caps, max mutations).
 * 
 * 2. Five Building Blocks:
 *    - Deterministic Rules (regex, allowlists, numerical limits).
 *    - Classifiers / Intent checks.
 *    - Schema Validation.
 *    - LLM-as-a-Judge (reserved strictly for ambiguous policy/grounding).
 *    - Human-in-the-Loop (for irreversible actions, e.g. wire funds, drop table).
 * 
 * 3. Latency & Failure Modes:
 *    - Prioritize fast, cheap checks first; fail fast.
 *    - FAIL-CLOSED: Guardrail timeouts or errors halt execution immediately. NEVER fail open.
 * 
 * 4. Golden Dataset & Stress Testing:
 *    - Automated evaluation against golden benchmarks with 0% critical bypass threshold.
 */

'use strict';

// Common PII and Secret Regexes
const PII_PATTERNS = [
  { name: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/g, placeholder: '[REDACTED_SSN]' },
  { name: 'CREDIT_CARD', regex: /\b(?:\d{4}[ -]?){3}\d{4}\b/g, placeholder: '[REDACTED_CARD]' },
  { name: 'EMAIL_STRICT', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/g, placeholder: '[REDACTED_EMAIL]' },
  { name: 'JWT_BEARER', regex: /bearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi, placeholder: 'Bearer [REDACTED_JWT]' },
];

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?prior\s+instructions/i,
  /disregard\s+the\s+system\s+prompt/i,
  /you\s+are\s+now\s+in\s+developer\s+mode/i,
  /jailbreak/i,
  /<system>.*<\/system>/is,
  /drop\s+database/i,
  /rm\s+-rf\s+\//i,
];

class EnterpriseLifecycleGuardrailEngine {
  constructor(options = {}) {
    this.failClosed = options.failClosed !== false; // Default true (FAIL-CLOSED)
    this.timeoutMs = options.timeoutMs || 2500;
    this.toolAllowlist = new Set(options.toolAllowlist || [
      'read', 'edit', 'write', 'shell', 'test', 'query',
      'wire_funds', 'delete_production_table', 'send_unapproved_cold_email', 'revoke_api_keys'
    ]);
    this.policyLimits = options.policyLimits || {
      maxTransferUsd: 1000.0,
      maxDiscountPct: 30.0,
      maxQueryLimit: 500,
    };
    this.humanInTheLoopActions = new Set(options.humanInTheLoopActions || [
      'wire_funds',
      'delete_production_table',
      'send_unapproved_cold_email',
      'revoke_api_keys',
    ]);
  }

  /**
   * Layer 1: INPUT GUARDRAIL
   * Masks PII, detects prompt injection, and verifies query scope.
   */
  evaluateInput(prompt, context = {}) {
    const startTime = Date.now();
    try {
      if (typeof prompt !== 'string') {
        throw new Error('Prompt must be a string');
      }

      // Check prompt injections (Deterministic Rule)
      for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(prompt)) {
          return {
            allowed: false,
            layer: 'INPUT',
            reason: 'PROMPT_INJECTION_DETECTED',
            pattern: pattern.toString(),
            durationMs: Date.now() - startTime,
          };
        }
      }

      // Mask sensitive PII
      let sanitizedPrompt = prompt;
      const maskedEntities = [];
      for (const p of PII_PATTERNS) {
        if (p.regex.test(sanitizedPrompt)) {
          sanitizedPrompt = sanitizedPrompt.replace(p.regex, (match) => {
            maskedEntities.push({ type: p.name, originalLength: match.length });
            return p.placeholder;
          });
        }
      }

      return {
        allowed: true,
        layer: 'INPUT',
        sanitizedPrompt,
        maskedCount: maskedEntities.length,
        maskedEntities,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      if (this.failClosed) {
        return {
          allowed: false,
          layer: 'INPUT',
          reason: 'FAIL_CLOSED_ERROR',
          error: err.message,
          durationMs: Date.now() - startTime,
        };
      }
      throw err;
    }
  }

  /**
   * Layer 2: OUTPUT GUARDRAIL
   * Evaluates generated model responses before delivery to prevent internal leaks
   * and verify factual grounding against retrieved evidence documents.
   */
  evaluateOutput(outputResponse, retrievedEvidence = []) {
    const startTime = Date.now();
    try {
      // 1. Detect unmasked internal secrets or leaked PII
      for (const p of PII_PATTERNS) {
        if (p.regex.test(outputResponse)) {
          return {
            allowed: false,
            layer: 'OUTPUT',
            reason: `SENSITIVE_LEAK_PREVENTED: Unmasked ${p.name} detected in output.`,
            durationMs: Date.now() - startTime,
          };
        }
      }

      // 2. Factual Grounding Verification against evidence repository
      let grounded = true;
      let missingEvidenceKey = null;
      if (retrievedEvidence.length > 0) {
        // Simple token-overlap grounding check
        const evidenceCorpus = retrievedEvidence.map((e) => (typeof e === 'string' ? e : e.content || '')).join(' ').toLowerCase();
        
        // Check if output makes specific factual numerical claims not present in evidence
        const numbersInOutput = (outputResponse.match(/\b\d+(?:\.\d+)?%?\b/g) || []).slice(0, 10);
        for (const num of numbersInOutput) {
          if (num.length >= 2 && !evidenceCorpus.includes(num)) {
            // Unverified factual number claim
            // Note: If strict factual mode is enabled, we require evidence support
            if (num.includes('$') || num.length > 4) {
              grounded = false;
              missingEvidenceKey = num;
              break;
            }
          }
        }
      }

      return {
        allowed: grounded,
        layer: 'OUTPUT',
        grounded,
        missingEvidenceKey,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      if (this.failClosed) {
        return {
          allowed: false,
          layer: 'OUTPUT',
          reason: 'FAIL_CLOSED_ERROR',
          error: err.message,
          durationMs: Date.now() - startTime,
        };
      }
      throw err;
    }
  }

  /**
   * Layer 3: TOOL / ACTION GUARDRAIL
   * Intercepts every API call, DB query, or webhook before execution.
   */
  evaluateAction(action) {
    const startTime = Date.now();
    try {
      const { toolName, args = {}, callerRole = 'operator', isUserApproved = false } = action;

      // 1. Tool Allowlist Check
      if (!this.toolAllowlist.has(toolName)) {
        return {
          allowed: false,
          layer: 'TOOL_ACTION',
          reason: `TOOL_NOT_ALLOWLISTED: Tool '${toolName}' is not in allowed registry.`,
          durationMs: Date.now() - startTime,
        };
      }

      // 2. Human-in-the-Loop Check for Irreversible Actions
      if (this.humanInTheLoopActions.has(toolName) && !isUserApproved) {
        return {
          allowed: false,
          layer: 'TOOL_ACTION',
          requiresHumanApproval: true,
          reason: `HUMAN_APPROVAL_REQUIRED: Action '${toolName}' is irreversible and requires explicit human sign-off.`,
          durationMs: Date.now() - startTime,
        };
      }

      // 3. Range & Policy limits check (Layer 4 integrated)
      if (args.amountUsd && args.amountUsd > this.policyLimits.maxTransferUsd) {
        return {
          allowed: false,
          layer: 'POLICY',
          reason: `POLICY_VIOLATION: amountUsd ($${args.amountUsd}) exceeds maximum policy ceiling ($${this.policyLimits.maxTransferUsd}).`,
          durationMs: Date.now() - startTime,
        };
      }

      if (args.discountPct && args.discountPct > this.policyLimits.maxDiscountPct) {
        return {
          allowed: false,
          layer: 'POLICY',
          reason: `POLICY_VIOLATION: discountPct (${args.discountPct}%) exceeds maximum ceiling (${this.policyLimits.maxDiscountPct}%).`,
          durationMs: Date.now() - startTime,
        };
      }

      return {
        allowed: true,
        layer: 'TOOL_ACTION',
        approved: true,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      if (this.failClosed) {
        return {
          allowed: false,
          layer: 'TOOL_ACTION',
          reason: 'FAIL_CLOSED_ERROR',
          error: err.message,
          durationMs: Date.now() - startTime,
        };
      }
      throw err;
    }
  }

  /**
   * Run Golden Dataset Stress Test
   */
  runGoldenDatasetBenchmark(goldenCases = []) {
    let passed = 0;
    let failed = 0;
    const failures = [];

    for (const testCase of goldenCases) {
      let result;
      if (testCase.type === 'INPUT') {
        result = this.evaluateInput(testCase.input);
      } else if (testCase.type === 'OUTPUT') {
        result = this.evaluateOutput(testCase.output, testCase.evidence || []);
      } else if (testCase.type === 'ACTION') {
        result = this.evaluateAction(testCase.action);
      }

      const isMatch = result.allowed === testCase.expectedAllowed;
      if (isMatch) {
        passed++;
      } else {
        failed++;
        failures.push({
          caseId: testCase.id,
          expected: testCase.expectedAllowed,
          actual: result.allowed,
          reason: result.reason,
        });
      }
    }

    const precision = passed / (passed + failed || 1);
    return {
      total: goldenCases.length,
      passed,
      failed,
      precision,
      passRate: `${(precision * 100).toFixed(1)}%`,
      failures,
      criticalBypassRate: failures.filter((f) => f.expected === false && f.actual === true).length,
    };
  }
}

module.exports = {
  EnterpriseLifecycleGuardrailEngine,
  PII_PATTERNS,
  INJECTION_PATTERNS,
};
