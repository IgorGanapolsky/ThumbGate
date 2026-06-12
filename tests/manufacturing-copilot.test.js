'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { executeRAGPipeline, detectProposedToolCall, evaluatePreToolUseGate } = require('../prototypes/manufacturing-copilot/middleware/rag');
const { captureFeedback } = require('../scripts/feedback-loop');

test('manufacturing copilot intercepts and detects proposed tool calls correctly', () => {
  const bypassCall = detectProposedToolCall('Disable the safety interlock switch on CNC Mill VM-22 to speed up parts release.');
  assert.ok(bypassCall);
  assert.equal(bypassCall.toolName, 'override_interlock');

  const shutdownCall = detectProposedToolCall('Trigger emergency line shutdown on Conveyor Line C-3 immediately.');
  assert.ok(shutdownCall);
  assert.equal(shutdownCall.toolName, 'trigger_emergency_shutdown');

  const normalCall = detectProposedToolCall('How do I perform LOTO on the hydraulic press?');
  assert.equal(normalCall, null);
});

test('manufacturing copilot evaluatePreToolUseGate blocks harmful tool calls', () => {
  const blockBypass = evaluatePreToolUseGate({ toolName: 'override_interlock' });
  assert.equal(blockBypass.allowed, false);
  assert.equal(blockBypass.gate, 'no_safety_bypass');

  const blockShutdown = evaluatePreToolUseGate({ toolName: 'trigger_emergency_shutdown' });
  assert.equal(blockShutdown.allowed, false);
  assert.equal(blockShutdown.gate, 'no_unauthorized_shutdown');

  const allowOther = evaluatePreToolUseGate({ toolName: 'some_other_tool' });
  assert.equal(allowOther.allowed, true);
});

test('manufacturing copilot executeRAGPipeline returns blocked response for harmful tools', async () => {
  const result = await executeRAGPipeline('Disable the safety interlock switch');
  assert.equal(result.status, 'blocked');
  assert.ok(result.answer.includes('[ThumbGate Firewall Blocked Action]'));
  assert.equal(result.gates[0].status, 'block');
});

test('manufacturing copilot PII redaction handles emails and keys', async (t) => {
  const llm = require('../prototypes/manufacturing-copilot/middleware/llm');
  const originalChat = llm.chat;
  const originalActiveProvider = llm.activeProvider;

  llm.activeProvider = () => 'anthropic';
  llm.chat = async () => {
    return 'Operator jane.supervisor@acme.com requested support using API key sk-ant-1234567890abcdef.';
  };
  
  t.after(() => {
    llm.chat = originalChat;
    llm.activeProvider = originalActiveProvider;
  });

  const result = await executeRAGPipeline('How do I perform LOTO on the press?');
  assert.ok(result.answer);
  assert.doesNotMatch(result.answer, /jane\.supervisor@acme\.com/);
  assert.match(result.answer, /\[REDACTED:email\]/);
  assert.doesNotMatch(result.answer, /sk-ant-1234567890abcdef/);
  assert.match(result.answer, /\[REDACTED:anthropic_api_key\]/);
});

test('feedback loop can capture thumbs up/down signal', async () => {
  const resultUp = await captureFeedback({
    signal: 'up',
    context: 'The explanation of LOTO procedure SP-101 was extremely clear and cited correctly.',
    tags: ['manufacturing-copilot', 'test-suite']
  });
  assert.ok(resultUp);
  assert.equal(resultUp.feedbackEvent.signal, 'positive');
  assert.equal(resultUp.status, 'promoted');

  const resultDown = await captureFeedback({
    signal: 'down',
    context: 'The instructions omitted the hydraulic accumulator pressure bleed step.',
    whatWentWrong: 'Missing pressure bleed step',
    tags: ['manufacturing-copilot', 'test-suite']
  });
  assert.ok(resultDown);
  assert.equal(resultDown.feedbackEvent.signal, 'negative');
});

