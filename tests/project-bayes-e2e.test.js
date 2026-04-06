// SET ENVIRONMENT VARIABLE FIRST
const fs = require('fs');
const path = require('path');
const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rlhf-bayes-e2e-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const { captureFeedback, readJSONL } = require('../scripts/feedback-loop');
const { callTool } = require('../adapters/mcp/server-stdio');
const assert = require('assert');

console.log('Testing Project Bayes E2E...');

async function run() {
  // 1. Create a highly uncertain belief through contradiction
  // Using longer contexts to pass MIN_CONTENT_LENGTH (20)
  console.log('  Creating conflicting history...');
  captureFeedback({ 
    signal: 'up', 
    context: 'User explicitly requested the use of tabs for all indentation in this project.', 
    tags: ['formatting'] 
  });
  captureFeedback({ 
    signal: 'down', 
    context: 'The user is now expressing a strong dislike for tabs and wants to switch to spaces.', 
    tags: ['formatting'] 
  });
  captureFeedback({ 
    signal: 'up', 
    context: 'The user has changed their mind again and confirms that tabs are indeed the preferred style.', 
    tags: ['formatting'] 
  });

  const memories = readJSONL(path.join(tmpDir, 'memory-log.jsonl'));
  console.log('  Memories in log count:', memories.length);

  // 2. Call estimate_uncertainty tool
  console.log('  Calling estimate_uncertainty tool...');
  const result = await callTool('estimate_uncertainty', { tags: ['formatting'] });
  
  const data = JSON.parse(result.content[0].text);
  console.log('  Tool Output:', data);
  
  assert.strictEqual(memories.length, 3);
  assert.ok(data.averageUncertainty > 0);

  console.log('PASS: Project Bayes E2E');
}

run().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
}).finally(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.THUMBGATE_FEEDBACK_DIR;
});
