#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const TEST_DIR = path.join(PROJECT_ROOT, '.thumbgate', 'adk-test-run');
const FEEDBACK_LOG = path.join(TEST_DIR, 'feedback-log.jsonl');
const RULES_PATH = path.join(TEST_DIR, 'prevention-rules.md');

// Mock data: 3 disparate failures that all point to "rushing without environment checks"
const mockLogs = [
  {
    id: 'fb_test_1',
    signal: 'negative',
    context: 'Tried to run npm install but failed due to missing node version',
    whatWentWrong: 'Did not check engines field in package.json before execution',
    tags: ['environment', 'npm'],
    timestamp: new Date().toISOString()
  },
  {
    id: 'fb_test_2',
    signal: 'negative',
    context: 'API 500 on /health endpoint during deployment script',
    whatWentWrong: 'Did not verify database connection string before starting server',
    tags: ['deployment', 'api'],
    timestamp: new Date().toISOString()
  },
  {
    id: 'fb_test_3',
    signal: 'negative',
    context: 'Test failure in integration-suite',
    whatWentWrong: 'Local environment variable PORT was already in use by another process',
    tags: ['testing', 'environment'],
    timestamp: new Date().toISOString()
  }
];

function setup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  
  const content = mockLogs.map(l => JSON.stringify(l)).join('\n') + '\n';
  fs.writeFileSync(FEEDBACK_LOG, content);
  console.log(`[Test Setup] Created mock logs at ${FEEDBACK_LOG}`);
}

function runConsolidator() {
  console.log('[Test Execution] Running adk-consolidator.js...');
  
  // We override THUMBGATE_FEEDBACK_DIR so it points to our test directory
  const env = { 
    ...process.env, 
    THUMBGATE_FEEDBACK_DIR: TEST_DIR,
    ADK_STATE_FILE: path.join(TEST_DIR, 'adk-state.json'),
    ADK_FAKE_CONSOLIDATION: 'true',
    NODE_ENV: 'test' 
  };
  
  const result = spawnSync('node', [path.join(PROJECT_ROOT, 'scripts', 'adk-consolidator.js')], { env, encoding: 'utf-8' });
  
  console.log('--- STDOUT ---');
  console.log(result.stdout);
  console.log('--- STDERR ---');
  console.log(result.stderr);
  
  return result.status === 0;
}

function verify() {
  console.log('[Test Verification] Checking for consolidated rules...');
  
  if (!fs.existsSync(RULES_PATH)) {
    console.error('FAIL: prevention-rules.md was not created.');
    return false;
  }
  
  const content = fs.readFileSync(RULES_PATH, 'utf-8');
  console.log('--- PREVENTION RULES CONTENT ---');
  console.log(content);
  
  const hasConsolidationHeader = content.includes('## ADK Semantic Consolidations');
  const hasAlwaysOrNever = content.includes('ALWAYS') || content.includes('NEVER');
  
  if (hasConsolidationHeader && hasAlwaysOrNever) {
    console.log('PASS: ADK Consolidator successfully synthesized semantic rules.');
    return true;
  } else {
    console.error('FAIL: Consolidator output does not match expected synthesized format.');
    return false;
  }
}

function cleanup() {
  // fs.rmSync(TEST_DIR, { recursive: true, force: true });
  console.log(`[Test Cleanup] Preserved test artifacts at ${TEST_DIR} for inspection.`);
}

(async () => {
  setup();
  const success = runConsolidator();
  if (success) {
    const verified = verify();
    cleanup();
    process.exit(verified ? 0 : 1);
  } else {
    console.error('Consolidator execution failed.');
    process.exit(1);
  }
})();
