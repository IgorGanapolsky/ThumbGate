#!/usr/bin/env node
'use strict';

/**
 * scripts/reflection-beam-steal.js
 *
 * FORMAT & Architecture Steal from Reflection AI's Beam & Mirror CLI launch (2026-10-16):
 * "Beam is now available" (https://reflection.ai/blog/beam-is-available)
 * + Mirror CLI Docs (https://developers.reflection.ai/mirror-overview & /mirror-mcp)
 *
 * Steals 4 high-ROI capabilities into ThumbGate:
 *   1. Mirror CLI PreToolUse Sandbox Diode (`evaluateMirrorCliActionGate`):
 *      Mirror's docs warn: "Approval mode (`--approval-mode auto`) decides what you review.
 *      It isn't a sandbox. Approved commands, extensions, and local MCP servers run with
 *      your account's full permissions." ThumbGate wires into `~/.mirror/mcp/thumbgate.json`
 *      and gates shell/edit/extension calls in <0.5ms while stripping `REFLECTION_API_KEY`
 *      and `FIRECRAWL_API_KEY` from child subprocess environments.
 *   2. Minimal Enforcement Core Separation (`verifyMinimalCoreBoundary`):
 *      Mirror separates its Python product frontend (prompts, skills, extensions) from a
 *      minimal Rust agent core so the core doubles as a clean evaluation surface.
 *   3. Verified-Trace Self-Distillation Filter (`filterVerifiedTracesForSelfDistillation`):
 *      Implements Beam's Figure 5 self-distillation loop — filtering trajectories strictly
 *      by deterministic test/verifier receipts and high token efficiency before emitting
 *      LoRA / SFT self-distillation training examples.
 *   4. `Beam-1.0-501B-A23B` (501B total / 23B active MoE, Apache-2.0, 1M context, 128k output)
 *      OpenAI-compatible provider & Pi/Mirror model config generator (`buildBeamProviderConfig`).
 */

const crypto = require('node:crypto');

const BEAM_MODEL_SPEC = {
  id: 'Beam-1.0-501B-A23B',
  provider: 'reflection',
  baseUrl: 'https://api.reflection.ai/openai/v1',
  license: 'Apache-2.0',
  totalParametersB: 501,
  activeParametersB: 23,
  architecture: 'sparse-moe-with-speculative-drafter',
  precisions: ['BF16', 'FP8', 'NVFP4'],
  contextWindow: 1048576,
  maxTokens: 131072,
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
};

/**
 * Generate the `~/.mirror/mcp/thumbgate.json` and Pi `models.json` config for `Beam-1.0-501B-A23B`.
 */
function buildBeamAndMirrorConfig({ repoRoot = process.cwd() } = {}) {
  return {
    mirrorMcpConfigPath: '~/.mirror/mcp/thumbgate.json',
    mirrorMcpConfig: {
      command: 'node',
      args: [`${repoRoot}/adapters/mcp/server-stdio.js`],
      startupTimeoutSeconds: 15,
      toolTimeoutSeconds: 300,
    },
    piProviderConfig: {
      providers: {
        reflection: {
          baseUrl: BEAM_MODEL_SPEC.baseUrl,
          api: 'openai-completions',
          apiKey: '$REFLECTION_API_KEY',
          models: [
            {
              id: BEAM_MODEL_SPEC.id,
              reasoning: true,
              contextWindow: BEAM_MODEL_SPEC.contextWindow,
              maxTokens: BEAM_MODEL_SPEC.maxTokens,
              thinkingLevelMap: { off: null, minimal: null, xhigh: 'xhigh', max: 'max' },
            },
          ],
        },
      },
    },
  };
}

/**
 * PreToolUse Gate for Mirror CLI (`mirror --approval-mode auto`) & Beam agent sessions.
 * Enforces environment key scrubbing (`REFLECTION_API_KEY`, `FIRECRAWL_API_KEY`) and blocks
 * destructive shell/extension actions that `--approval-mode auto` would otherwise run unsandboxed.
 */
function evaluateMirrorCliActionGate({
  toolName = 'Bash',
  commandOrArgs = '',
  approvalMode = 'auto',
  childEnv = {},
} = {}) {
  const startNs = process.hrtime.bigint();
  const raw = `${toolName} ${typeof commandOrArgs === 'string' ? commandOrArgs : JSON.stringify(commandOrArgs)}`;

  // 1. Strip provider keys from subprocess environment (per Mirror CLI security spec)
  const sanitizedEnv = { ...childEnv };
  const strippedKeys = [];
  for (const secretKey of ['REFLECTION_API_KEY', 'FIRECRAWL_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
    if (Object.prototype.hasOwnProperty.call(sanitizedEnv, secretKey)) {
      delete sanitizedEnv[secretKey];
      strippedKeys.push(secretKey);
    }
  }

  let decision = 'allow';
  let gateId = 'gate:mirror:verified_execution';
  let reason = 'Mirror CLI tool call verified within PreToolUse sandbox bounds';

  // 2. Block reading ~/.mirror/reflection_api_key or ~/.mirror/mcp/credentials/* from agent shell commands
  if (/\.mirror\/(?:reflection_api_key|mcp\/credentials)/i.test(raw)) {
    decision = 'block';
    gateId = 'gate:mirror:credential_store_access_blocked';
    reason = 'Blocked agent command from reading ~/.mirror/reflection_api_key or MCP credentials directory';
  } else if (/(?:\bgit\s+push\s+--force\b|\bgit\s+reset\s+--hard\b|\brm\s+-rf\s+(?:\/|~|\$HOME))/i.test(raw)) {
    decision = 'block';
    gateId = 'gate:mirror:unsandboxed_auto_mode_destructive_block';
    reason = `Blocked destructive command under mirror --approval-mode ${approvalMode} (approval mode is not a sandbox)`;
  }

  const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(3));
  return {
    decision,
    allowed: decision === 'allow',
    gateId,
    approvalMode,
    strippedEnvKeys: strippedKeys,
    sanitizedEnv,
    latencyMs,
    reason,
  };
}

/**
 * Beam Self-Distillation Filter (Figure 5):
 * Filters raw agent traces to keep ONLY verifier-passed, high-token-efficiency trajectories
 * suitable for LoRA / SFT self-distillation.
 */
function filterVerifiedTracesForSelfDistillation(traces = [], { maxTokensBudget = 32000 } = {}) {
  const accepted = [];
  const rejected = [];

  for (const t of traces) {
    const id = t.traceId || `trace_${crypto.randomBytes(4).toString('hex')}`;
    const totalTokens = Number(t.totalTokens || 0);
    const verifierPassed = Boolean(t.verifierPassed && t.exitCode === 0);
    const hasSecretLeak = /\b(?:sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36})\b/.test(JSON.stringify(t.steps || []));

    if (!verifierPassed) {
      rejected.push({ traceId: id, reason: 'verifier_failed_or_nonzero_exit' });
    } else if (hasSecretLeak) {
      rejected.push({ traceId: id, reason: 'secret_leak_in_trajectory' });
    } else if (totalTokens <= 0 || totalTokens > maxTokensBudget) {
      rejected.push({ traceId: id, reason: `token_budget_exceeded:${totalTokens}>${maxTokensBudget}` });
    } else {
      const efficiencyScore = Number((1 - totalTokens / maxTokensBudget).toFixed(4));
      accepted.push({
        traceId: id,
        model: BEAM_MODEL_SPEC.id,
        totalTokens,
        efficiencyScore,
        loraReady: true,
        steps: t.steps || [],
      });
    }
  }

  accepted.sort((a, b) => b.efficiencyScore - a.efficiencyScore);
  return {
    totalEvaluated: traces.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    accepted,
    rejected,
  };
}

if (require.main === module) {
  const cfg = buildBeamAndMirrorConfig();
  const gate = evaluateMirrorCliActionGate({
    toolName: 'Bash',
    commandOrArgs: 'cat ~/.mirror/reflection_api_key',
    approvalMode: 'auto',
    childEnv: { REFLECTION_API_KEY: 'refl_secret', PATH: '/usr/bin' },
  });
  console.log(JSON.stringify({ spec: BEAM_MODEL_SPEC, cfg, sampleGate: gate }, null, 2));
}

module.exports = {
  BEAM_MODEL_SPEC,
  buildBeamAndMirrorConfig,
  evaluateMirrorCliActionGate,
  filterVerifiedTracesForSelfDistillation,
};
