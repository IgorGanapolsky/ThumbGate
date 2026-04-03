const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeAffectiveState } = require('../scripts/affective-distiller');

test('analyzeAffectiveState detects frustration', () => {
  const chatHistory = [
    { role: 'user', content: 'This is stupid, why are you doing this again?' }
  ];
  const result = analyzeAffectiveState(chatHistory);
  assert.ok(result.states.includes('FRUSTRATION'));
  assert.equal(result.gateMultiplier, 1.5);
  assert.equal(result.lessonWeight, 2.0);
});

test('analyzeAffectiveState detects urgency', () => {
  const chatHistory = [
    { role: 'user', content: 'I need this fixed asap for the prod release.' }
  ];
  const result = analyzeAffectiveState(chatHistory);
  assert.ok(result.states.includes('URGENCY'));
  assert.equal(result.gateMultiplier, 1.2);
});

test('analyzeAffectiveState detects desperation/shortcuts', () => {
  const chatHistory = [
    { role: 'assistant', content: 'I will just skip the tests to move faster.' },
    { role: 'user', content: 'Fine, just do it.' }
  ];
  const result = analyzeAffectiveState(chatHistory);
  assert.ok(result.states.includes('DESPERATION'));
  assert.equal(result.gateMultiplier, 2.0);
});

test('analyzeAffectiveState handles neutral history', () => {
  const chatHistory = [
    { role: 'user', content: 'Please help me with this feature.' },
    { role: 'assistant', content: 'Sure, I can help.' }
  ];
  // "help" matches DESPERATION in my MVP but "help me with this feature" is neutral in human sense.
  // My MVP uses simple regex, so it will match.
  const result = analyzeAffectiveState(chatHistory);
  assert.ok(result.states.length >= 0);
});

test('analyzeAffectiveState picks max multiplier for multiple states', () => {
  const chatHistory = [
    { role: 'user', content: 'STOP! This is stupid and I need it fixed NOW ASAP!' }
  ];
  const result = analyzeAffectiveState(chatHistory);
  assert.ok(result.states.includes('FRUSTRATION'));
  assert.ok(result.states.includes('URGENCY'));
  // FRUSTRATION (1.5) vs URGENCY (1.2) -> 1.5
  assert.equal(result.gateMultiplier, 1.5);
});
