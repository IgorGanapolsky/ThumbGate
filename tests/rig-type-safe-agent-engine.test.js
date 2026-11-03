const assert = require('node:assert');
const { RigTypeSafeAgentEngine } = require('../scripts/rig-type-safe-agent-engine');

const engine = new RigTypeSafeAgentEngine();

// 1. Type-Safe Tool Registration & Validation
console.log('Testing Type-Safe Tool Registration & Execution...');
engine.registerTool('calculate_sum', { a: 'number', b: 'number' }, (args) => {
  return args.a + args.b;
});

// Valid execution
async function runTests() {
  const sumResult = await engine.executeTool('calculate_sum', { a: 10, b: 35 });
  assert.strictEqual(sumResult, 45);

  // Invalid type execution (should throw)
  let failed = false;
  try {
    await engine.executeTool('calculate_sum', { a: '10', b: 35 });
  } catch (err) {
    failed = true;
    assert.ok(err.message.includes('Type-safety validation failed'));
  }
  assert.strictEqual(failed, true, 'Should catch type mismatch');

  // 2. Agents-as-Tools (Manager-Worker Pattern)
  console.log('Testing Agents-as-Tools Pattern...');
  engine.registerAgentAsTool(
    'admin_worker',
    'Handles administrative tasks and document drafting.',
    async (prompt) => `Drafted document for prompt: "${prompt}"`
  );

  const workerResponse = await engine.invokeAgentTool('admin_worker', 'Draft welcome email');
  assert.ok(workerResponse.includes('Drafted document'));

  console.log('✅ RigTypeSafeAgentEngine tests passed');
}

runTests();
