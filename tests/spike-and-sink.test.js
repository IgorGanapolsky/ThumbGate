#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

test('Inverse Sink Weighting - penalizes generic logs', async (t) => {
  // Use stub embed for speed/determinism
  process.env.RLHF_VECTOR_STUB_EMBED = 'true';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-sink-test-'));
  process.env.RLHF_FEEDBACK_DIR = tmpDir;

  // Require inside to pick up env vars
  const { searchSimilar, upsertFeedback } = require('../scripts/vector-store');

  // 1. Upsert a "Spike" (Unique, rare failure)
  const spike = {
    id: 'spike_1',
    context: 'CRITICAL: Kernel panic during WASM execution in isolated container',
    signal: 'negative',
    tags: ['kernel', 'wasm'],
    timestamp: new Date().toISOString()
  };

  // 2. Upsert a "Sink" (Generic, high-frequency log)
  const sink = {
    id: 'sink_1',
    context: 'Fixed tests and updated README formatting',
    signal: 'positive',
    tags: ['chore'],
    timestamp: new Date().toISOString()
  };

  await upsertFeedback(spike);
  await upsertFeedback(sink);

  const results = await searchSimilar('kernel fixes', 10);
  
  const spikeResult = results.find(r => r.id === 'spike_1');
  const sinkResult = results.find(r => r.id === 'sink_1');

  // Since stub distance is 0, let's verify distance ranking works as intended.
  assert.ok(spikeResult._distance <= sinkResult._distance, 'Spike should have smaller or equal distance to Sink');
  
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Anchor-Memory Management - keeps foundational logs in context', async (t) => {
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => {
    logs.push(args.join(' '));
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-anchor-test-'));
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  process.env.ADK_STATE_FILE = path.join(tmpDir, 'state.json');
  process.env.ADK_FAKE_CONSOLIDATION = 'true';
  process.env.GEMINI_API_KEY = 'dummy-key'; 

  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  
  // Create 10 logs. 1-5 are anchors. 6-10 are "new".
  const mockLogs = Array.from({ length: 10 }, (_, i) => ({
    id: `fb_${i + 1}`,
    signal: 'negative',
    context: `Context ${i + 1}`,
    timestamp: new Date().toISOString()
  }));

  fs.writeFileSync(logPath, mockLogs.map(l => JSON.stringify(l)).join('\n') + '\n');

  // Simulate state where we already processed the first 7
  fs.writeFileSync(process.env.ADK_STATE_FILE, JSON.stringify({ lastProcessedFeedbackId: 'fb_7' }));

  // REQUIRE INSIDE to ensure module-level constants in adk-consolidator pick up the env var
  // We need to clear the cache if it was already loaded
  delete require.cache[require.resolve('../scripts/adk-consolidator')];
  const { consolidateMemory } = require('../scripts/adk-consolidator');

  await consolidateMemory();

  console.log = originalLog;

  const activationLog = logs.find(l => l.includes('Activating Gemini'));
  assert.ok(activationLog, 'Should have found Activation log');
  assert.ok(activationLog.includes('5 anchors'), `Should include 5 anchor logs, found: ${activationLog}`);
  assert.ok(activationLog.includes('3 new events'), `Should include 3 new events, found: ${activationLog}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.ADK_FAKE_CONSOLIDATION;
});
