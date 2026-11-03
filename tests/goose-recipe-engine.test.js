const assert = require('node:assert');
const { GooseRecipeEngine } = require('../scripts/goose-recipe-engine');

const engine = new GooseRecipeEngine();

// 1. Register Portable Recipe
console.log('Testing Portable Recipe Registration & Execution...');
const sampleRecipe = {
  description: 'Deploy and Verify Workflow',
  steps: [
    { action: 'Build project for $env' },
    { action: 'Run tests with timeout $timeout' },
    { action: 'Notify channel $channel' }
  ]
};

const regResult = engine.registerRecipe('deploy-flow', sampleRecipe);
assert.strictEqual(regResult.registered, true);
assert.strictEqual(regResult.stepCount, 3);

// 2. Execute Recipe with Parameters
async function runTests() {
  const result = await engine.executeRecipe('deploy-flow', {
    env: 'production',
    timeout: '60s',
    channel: '#releases'
  });

  assert.strictEqual(result.status, 'COMPLETED');
  assert.strictEqual(result.stepsExecuted, 3);
  assert.strictEqual(result.log[0].action, 'Build project for production');
  assert.strictEqual(result.log[1].action, 'Run tests with timeout 60s');
  assert.strictEqual(result.log[2].action, 'Notify channel #releases');

  // 3. Render MCP App Card
  console.log('Testing MCP Interactive UI Rendering...');
  const card = engine.renderMcpAppCard('Approval Required', 'form', {
    amount: 149.00,
    vendor: 'RentAHuman'
  });

  assert.strictEqual(card.renderType, 'MCP_INTERACTIVE_UI');
  assert.strictEqual(card.component.title, 'Approval Required');
  assert.strictEqual(card.component.data.amount, 149.00);

  console.log('✅ GooseRecipeEngine tests passed');
}

runTests();
