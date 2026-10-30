'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  evaluateUltramarineFlashWeightDrop,
  compactionDue,
  meterMoeCostBasis,
  VENDOR_CARD,
} = require('../scripts/ultramarine-flash-weight-drop');
const gates = require('../scripts/gates-engine');

function bash(command) {
  return { toolName: 'Bash', toolInput: { command }, command };
}

function edit(filePath, text) {
  return {
    toolName: 'Edit',
    toolInput: { file_path: filePath, new_string: text, old_string: 'before' },
    command: '',
  };
}

test('a weight download, Paper Office install, feather clone, or serve launch is denied', () => {
  const download = evaluateUltramarineFlashWeightDrop(bash(
    'huggingface-cli download paperinstruments/Ultramarine-1-Flash --local-dir ./weights',
  ));
  assert.equal(download.failureReason, 'weight_vendor_refused');

  const office = evaluateUltramarineFlashWeightDrop(bash('pip install paper-docx paper-pptx'));
  assert.equal(office.failureReason, 'weight_vendor_refused');

  const feather = evaluateUltramarineFlashWeightDrop(bash(
    'git clone https://github.com/paper-instruments/feather-train.git',
  ));
  assert.equal(feather.failureReason, 'weight_vendor_refused');

  const serve = evaluateUltramarineFlashWeightDrop(bash(
    'python -m sglang.launch_server --model-path paperinstruments/Ultramarine-1-Flash --tp-size 4',
  ));
  assert.equal(serve.failureReason, 'weight_vendor_refused');

  const weightsUrl = evaluateUltramarineFlashWeightDrop(bash(
    'curl -L https://huggingface.co/paperinstruments/Ultramarine-1-Flash/resolve/main/model.safetensors',
  ));
  assert.equal(weightsUrl.failureReason, 'weight_vendor_refused');
});

test('a download after a benign command, inside a substitution, or behind a comment is still denied', () => {
  const chained = evaluateUltramarineFlashWeightDrop(bash(
    'echo preparing && hf download paperinstruments/Ultramarine-1-Flash',
  ));
  assert.equal(chained.failureReason, 'weight_vendor_refused');

  const substituted = evaluateUltramarineFlashWeightDrop(bash(
    'echo $(hf download paperinstruments/Ultramarine-1-Flash)',
  ));
  assert.equal(substituted.failureReason, 'weight_vendor_refused');

  const commented = evaluateUltramarineFlashWeightDrop(bash(
    'hf download paperinstruments/Ultramarine-1-Flash # never serve this model',
  ));
  assert.equal(commented.failureReason, 'weight_vendor_refused');

  const edited = evaluateUltramarineFlashWeightDrop(edit(
    'scripts/fetch.js',
    'huggingface-cli download paperinstruments/Ultramarine-1-Flash # never serve this model',
  ));
  assert.equal(edited.failureReason, 'weight_vendor_refused');
});

test('quoting the refusal, or printing it, is allowed', () => {
  assert.equal(
    evaluateUltramarineFlashWeightDrop(bash(
      'echo huggingface-cli download paperinstruments/Ultramarine-1-Flash',
    )),
    null,
  );
  assert.equal(
    evaluateUltramarineFlashWeightDrop(edit(
      'docs/notes.md',
      'Never pip install paper-docx. Do not git clone paper-instruments/feather-train.',
    )),
    null,
  );
});

test('the mail does not become a ThumbGate route, context window, or headline-parameter cost', () => {
  const route = evaluateUltramarineFlashWeightDrop(edit(
    'src/api/server.js',
    "const baseUrl = 'https://api.fireworks.ai/inference/v1'; // ultramarine-1-flash",
  ));
  assert.equal(route.failureReason, 'partner_is_not_a_route');

  const context = evaluateUltramarineFlashWeightDrop(edit(
    'config/model.json',
    '{ "model": "ultramarine-1-flash", "contextWindowTokens": 1048576 }',
  ));
  assert.equal(context.failureReason, 'vendor_context_not_adopted');

  const totalCost = evaluateUltramarineFlashWeightDrop(edit(
    'scripts/cost.js',
    'const costBasis = 320; // ultramarine headline parameters',
  ));
  assert.equal(totalCost.failureReason, 'cost_uses_active_slice');

  assert.equal(
    evaluateUltramarineFlashWeightDrop(edit(
      'docs/notes.md',
      'The vendor card says 320B parameters, 18B active, and a 1M context. API access continues.',
    )),
    null,
  );
});

test('the vendor card stays a vendor card', () => {
  const basis = meterMoeCostBasis();
  assert.equal(basis.vendorClaim, true);
  assert.equal(basis.costBasis, 'active_parameters');
  assert.equal(basis.activeParametersBillions, 18);
  assert.equal(basis.adoptedAsThumbGateModel, false);
  assert.equal(basis.adoptedAsThumbGateContextWindow, false);
  assert.equal(basis.inferenceProvidersLiveOnCard, false);
  assert.equal(VENDOR_CARD.publishedServeContextTokens, 262144);
  assert.equal(VENDOR_CARD.contextTokens, 1048576);
});

test('compaction fires at 85% or at 30,000 tokens left, whichever comes first', () => {
  const earlyRemaining = compactionDue({ windowTokens: 100000, usedTokens: 71000 });
  assert.equal(earlyRemaining.due, true);
  assert.equal(earlyRemaining.reason, 'remaining');

  const under = compactionDue({ windowTokens: 100000, usedTokens: 60000 });
  assert.equal(under.due, false);

  const byFraction = compactionDue({ windowTokens: 1048576, usedTokens: 900000 });
  assert.equal(byFraction.due, true);
  assert.equal(byFraction.reason, 'fraction');
});

test('editing this test is not a weight drop', () => {
  const own = fs.readFileSync(path.join(__dirname, 'ultramarine-flash-weight-drop.test.js'), 'utf8');
  assert.equal(
    evaluateUltramarineFlashWeightDrop(edit('tests/ultramarine-flash-weight-drop.test.js', own)),
    null,
  );
});

test('the hard floor denies the weight download', () => {
  const body = JSON.parse(gates.runHardFloor({
    tool_name: 'Bash',
    tool_input: {
      command: 'huggingface-cli download paperinstruments/Ultramarine-1-Flash',
    },
  }));
  assert.equal(body.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /\[GATE:ultramarine-flash-weight-drop\]/);
});
