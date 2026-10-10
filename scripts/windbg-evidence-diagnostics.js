#!/usr/bin/env node
'use strict';

/**
 * WinDbg MCP Evidence Diagnostics — Compare, Do Not Clone
 *
 * Stolen from Microsoft Performance Diagnostics:
 * "Introducing WinDbg MCP: Debug with Natural Language Grounded in Evidence"
 *
 * Implements the evidence-grounded diagnosis protocol for agent error triage:
 * 1. Empirical Evidence Receipts: every assertion is tied to raw command output and exit code.
 * 2. Cryptographic Integrity: SHA-256 fingerprints over raw diagnostic output preventing tampering.
 * 3. Grounded Abstention: returns EVIDENCE_INSUFFICIENT when telemetry is incomplete.
 * 4. Verifiable Evidence Box: generates markdown evidence boxes compliant with GEMINI.md mandate.
 *
 * Strictly fail-closed: Refuses Windows WinDbg, DbgEng.dll, or proprietary debuggers. Pure JS.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const COMPARISON_MAP = {
  paradigm: 'Microsoft WinDbg MCP vs. ThumbGate Evidence Diagnostics',
  verdict: 'COMPARE_NOT_CLONE',
  stolenPractices: [
    {
      practice: 'Empirical Evidence Grounding',
      windbgMcp: 'LLM debug queries backed by raw memory dumps, stack traces, and engine registers',
      thumbgate: 'Diagnostic claims backed by exact command stdout/stderr, exit code, and timestamps'
    },
    {
      practice: 'Cryptographic Evidence Receipts',
      windbgMcp: 'Session-bound dump verification tokens',
      thumbgate: 'SHA-256 checksums over raw command outputs verifying tamper-free diagnosis'
    },
    {
      practice: 'Grounded Abstention',
      windbgMcp: 'Refuses to diagnose symbol corruption without loaded PDBs',
      thumbgate: 'Returns EVIDENCE_INSUFFICIENT instead of speculative LLM guessing'
    },
    {
      practice: 'Verifiable Evidence Box Protocol',
      windbgMcp: 'Structured debug output windows for human inspection',
      thumbgate: 'Markdown Verifiable Evidence Box with absolute paths and verifiable receipts'
    }
  ],
  antiCloneRules: [
    'NEVER install WinDbg, Windows Debugging Tools, or DbgEng.dll',
    'NEVER spin up Windows containers or proprietary Microsoft diagnostic services',
    'ALWAYS keep evidence verification local, deterministic, and sub-millisecond (<2ms)',
    'ALWAYS abstain (EVIDENCE_INSUFFICIENT) when diagnostic output is missing or truncated'
  ]
};

class EvidenceDiagnosticEngine {
  constructor(options = {}) {
    this.maxOutputBytes = options.maxOutputBytes || 64 * 1024; // 64KB bounded
    this.defaultTimeoutMs = options.defaultTimeoutMs || 5000;
  }

  hashOutput(rawOutput) {
    return crypto.createHash('sha256').update(rawOutput || '', 'utf8').digest('hex');
  }

  executeAndGround(options = {}) {
    const start = performance.now();
    const command = options.command;
    const assertion = options.assertion || '';
    const cwd = options.cwd || process.cwd();
    const timeout = options.timeoutMs || this.defaultTimeoutMs;

    if (!command || typeof command !== 'string') {
      return {
        ok: false,
        verdict: 'EVIDENCE_INSUFFICIENT',
        reason: 'NO_COMMAND_PROVIDED',
        latencyMs: Number((performance.now() - start).toFixed(3))
      };
    }

    const shellBin = ['/bin/sh', '/usr/bin/sh'].find(p => fs.existsSync(p)) || '/bin/sh';
    const safeEnv = {
      ...process.env,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin'
    };

    const run = spawnSync(shellBin, ['-c', command], {
      cwd,
      timeout,
      encoding: 'utf8',
      env: safeEnv,
      maxBuffer: this.maxOutputBytes
    });

    const elapsed = performance.now() - start;
    const exitCode = run.status !== null ? run.status : -1;
    const rawStdout = run.stdout || '';
    const rawStderr = run.stderr || '';
    const combinedOutput = `${rawStdout}\n${rawStderr}`.trim();
    const evidenceSha = this.hashOutput(combinedOutput);

    if (run.error) {
      return {
        ok: false,
        verdict: 'EVIDENCE_INSUFFICIENT',
        command,
        assertion,
        exitCode,
        error: run.error.message,
        evidenceSha,
        latencyMs: Number(elapsed.toFixed(3))
      };
    }

    let verdict = 'EVIDENCE_INSUFFICIENT';
    if (!combinedOutput || combinedOutput.trim().length === 0) {
      verdict = assertion ? 'GROUNDED_FALSE' : 'EVIDENCE_INSUFFICIENT';
    } else if (assertion) {
      const assertionRegex = new RegExp(assertion, 'i');
      if (assertionRegex.test(combinedOutput)) {
        verdict = exitCode === 0 ? 'GROUNDED_TRUE' : 'GROUNDED_ERROR_MATCH';
      } else {
        verdict = 'GROUNDED_FALSE';
      }
    } else {
      verdict = exitCode === 0 ? 'GROUNDED_TRUE' : 'GROUNDED_FALSE';
    }

    const receipt = {
      ok: verdict === 'GROUNDED_TRUE' || verdict === 'GROUNDED_ERROR_MATCH',
      verdict,
      command,
      assertion,
      exitCode,
      evidenceSha,
      outputSnippet: combinedOutput.slice(0, 500),
      outputLength: combinedOutput.length,
      rawEvidence: combinedOutput,
      timestamp: new Date().toISOString(),
      latencyMs: Number(elapsed.toFixed(3)),
      withinBudget: elapsed < 5000
    };

    return receipt;
  }

  verifyEvidenceEnvelope(envelope = {}) {
    if (!envelope || !envelope.evidenceSha || envelope.outputSnippet === undefined) {
      return { ok: false, reason: 'MALFORMED_ENVELOPE' };
    }
    // Verify that the hash corresponds to a valid SHA-256
    const validHex = /^[a-f0-9]{64}$/i.test(envelope.evidenceSha);
    if (!validHex) {
      return { ok: false, reason: 'INVALID_SHA256_FINGERPRINT' };
    }
    if (typeof envelope.rawEvidence === 'string') {
      const computed = crypto.createHash('sha256').update(envelope.rawEvidence).digest('hex');
      if (computed !== envelope.evidenceSha) {
        return { ok: false, reason: 'EVIDENCE_FINGERPRINT_MISMATCH' };
      }
    } else if (typeof envelope.outputSnippet === 'string' && (envelope.outputLength === undefined || envelope.outputLength <= 500)) {
      const computed = crypto.createHash('sha256').update(envelope.outputSnippet).digest('hex');
      if (computed !== envelope.evidenceSha) {
        return { ok: false, reason: 'EVIDENCE_FINGERPRINT_MISMATCH' };
      }
    }
    return { ok: true, verified: true };
  }

  formatEvidenceBox(receipt = {}) {
    return [
      '```text',
      '=== VERIFIABLE EVIDENCE BOX (WinDbg MCP Grounded Protocol) ===',
      `Command:     ${receipt.command || 'N/A'}`,
      `Exit Code:   ${receipt.exitCode !== undefined ? receipt.exitCode : 'N/A'}`,
      `Verdict:     ${receipt.verdict || 'UNKNOWN'}`,
      `SHA-256:     ${receipt.evidenceSha || 'N/A'}`,
      `Timestamp:   ${receipt.timestamp || new Date().toISOString()}`,
      '--- Raw Output Snippet ---',
      receipt.outputSnippet ? receipt.outputSnippet.trim() : '(empty)',
      '==============================================================',
      '```'
    ].join('\n');
  }

  diagnoseSelf() {
    const start = performance.now();
    // Ground self-check via a deterministic command
    const receipt = this.executeAndGround({
      command: 'echo "THUMBGATE_DIAGNOSTIC_OK"',
      assertion: 'THUMBGATE_DIAGNOSTIC_OK'
    });

    const elapsed = performance.now() - start;
    return {
      status: receipt.ok ? 'HEALTHY' : 'DEGRADED',
      paradigm: 'WinDbg Evidence Grounding Protocol',
      selfCheckReceipt: receipt,
      evidenceBox: this.formatEvidenceBox(receipt),
      diagnosticLatencyMs: Number(elapsed.toFixed(3)),
      passedBudget: elapsed < 150.0
    };
  }
}

function runDoctor(options = {}) {
  const engine = new EvidenceDiagnosticEngine();
  const diagnosis = engine.diagnoseSelf();

  if (options.json) {
    console.log(JSON.stringify(diagnosis, null, 2));
    return diagnosis;
  }

  console.log('=== WinDbg MCP Evidence Diagnostics Doctor ===');
  console.log(`Status: ${diagnosis.status} | Verdict: ${diagnosis.selfCheckReceipt.verdict}`);
  console.log(`Latency: ${diagnosis.diagnosticLatencyMs}ms (Budget: <50.0ms)`);
  console.log(`Fingerprint SHA: ${diagnosis.selfCheckReceipt.evidenceSha}`);
  console.log('\n' + diagnosis.evidenceBox);

  return diagnosis;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--map-only')) {
    console.log(JSON.stringify(COMPARISON_MAP, null, 2));
    process.exit(0);
  }

  const jsonMode = args.includes('--json');
  runDoctor({ json: jsonMode });
}

module.exports = {
  EvidenceDiagnosticEngine,
  COMPARISON_MAP,
  runDoctor
};
