#!/usr/bin/env node
'use strict';

const { scanText, buildSafeSummary, redactText } = require('./secret-scanner');

function getFeedbackLoopModule() {
  try {
    return require('./feedback-loop');
  } catch {
    return null;
  }
}

function buildPromptGuardOutput(scanResult) {
  return {
    continue: false,
    suppressOutput: true,
    stopReason: buildSafeSummary(
      scanResult.findings,
      'Prompt blocked because it appears to contain secret material'
    ),
  };
}

function evaluatePromptGuard(prompt, options = {}) {
  const text = String(prompt || '');
  if (!text.trim()) {
    return null;
  }

  const scanResult = scanText(text, { provider: options.provider, source: 'prompt' });
  if (!scanResult.detected) {
    return null;
  }

  const feedbackLoop = getFeedbackLoopModule();
  if (feedbackLoop && typeof feedbackLoop.appendDiagnosticRecord === 'function') {
    feedbackLoop.appendDiagnosticRecord({
      source: 'secret_guard',
      step: 'user_prompt_submit',
      context: redactText(text).slice(0, 400),
      metadata: {
        provider: scanResult.provider,
        promptLength: text.length,
      },
      diagnosis: {
        diagnosed: true,
        rootCauseCategory: 'guardrail_triggered',
        criticalFailureStep: 'user_prompt_submit',
        violations: scanResult.findings.map((finding) => ({
          constraintId: `security:${finding.id || 'secret_exfiltration'}`,
          description: finding.reason || finding.label || 'Secret exposure blocked',
          metadata: {
            label: finding.label || finding.id || 'secret',
            line: finding.line || null,
            source: finding.source || null,
          },
        })),
        evidence: scanResult.findings.map((finding) => finding.label || finding.id || 'secret'),
      },
    });
  }

  return buildPromptGuardOutput(scanResult);
}

function main() {
  const prompt = process.env.CLAUDE_USER_PROMPT || process.env.THUMBGATE_USER_PROMPT || '';
  const result = evaluatePromptGuard(prompt);
  if (!result) {
    return;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildPromptGuardOutput,
  evaluatePromptGuard,
};
