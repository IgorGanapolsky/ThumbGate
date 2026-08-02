#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output') options.output = argv[++index];
  }
  return options;
}

function validateRuntimeProof({ vector, profile, status }) {
  if (!status.available) {
    throw new Error(`Transformers.js provider unavailable: ${status.reason}`);
  }
  if (!Array.isArray(vector) || vector.length !== 384) {
    throw new Error(`Expected a 384-dimensional embedding, got ${vector?.length || 0}`);
  }
  if (!vector.every(Number.isFinite)) {
    throw new Error('Embedding contains non-finite values');
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  if (norm < 0.9 || norm > 1.1) {
    throw new Error(`Expected a normalized embedding, got norm=${norm}`);
  }
  if (profile?.source !== 'local-transformers') {
    throw new Error(`Expected local-transformers provenance, got ${profile?.source || 'none'}`);
  }
  if (profile?.activeProfile?.qualityTier !== 'production') {
    throw new Error(`Expected production quality tier, got ${profile?.activeProfile?.qualityTier || 'none'}`);
  }
  if (profile?.activeProfile?.model !== 'Xenova/all-MiniLM-L6-v2') {
    throw new Error(`Unexpected embedding model: ${profile?.activeProfile?.model || 'none'}`);
  }
  return Number(norm.toFixed(6));
}

async function proveTransformersRuntime(options = {}) {
  const originalFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const temporaryFeedbackDir = originalFeedbackDir
    ? null
    : fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-transformers-proof-'));
  if (temporaryFeedbackDir) process.env.THUMBGATE_FEEDBACK_DIR = temporaryFeedbackDir;

  try {
    const vectorStore = require('./vector-store');
    const status = vectorStore.getLocalTransformerProviderStatus();
    const startedAt = Date.now();
    const vector = await vectorStore.embedWithLocalTransformers(
      options.text || 'Block destructive shell commands before an AI agent executes them.',
      { kind: 'query' },
    );
    const profile = vectorStore.getLastEmbeddingProfile();
    const norm = validateRuntimeProof({ vector, profile, status });
    return {
      ok: true,
      provider: status.provider,
      providerReason: status.reason,
      node: process.version,
      minimumNode: status.minimumNode,
      dimensions: vector.length,
      finite: true,
      norm,
      source: profile.source,
      qualityTier: profile.activeProfile.qualityTier,
      profileId: profile.activeProfile.id,
      model: profile.activeProfile.model,
      fallbackUsed: profile.fallbackUsed,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    if (temporaryFeedbackDir) {
      fs.rmSync(temporaryFeedbackDir, { recursive: true, force: true });
      if (originalFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
      else process.env.THUMBGATE_FEEDBACK_DIR = originalFeedbackDir;
    }
  }
}

async function runCli() {
  const options = parseArgs(process.argv.slice(2));
  try {
    const report = await proveTransformersRuntime();
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) {
      fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
      fs.writeFileSync(path.resolve(options.output), output);
    }
    process.stdout.write(output);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      node: process.version,
      error: error.message,
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) runCli();

module.exports = {
  parseArgs,
  validateRuntimeProof,
  proveTransformersRuntime,
};
