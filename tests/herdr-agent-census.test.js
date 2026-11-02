'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { formatHerdrCensus } = require('../.claude/scripts/session-bootstrap/herdr-agent-census.js');

test('reads the Herdr 0.9 wrapped agent list and the fields those rows use', () => {
  const line = formatHerdrCensus({
    id: 'cli:agent:list',
    result: {
      agents: [{
        agent: 'omp',
        agent_status: 'working',
        cwd: '/Users/example/ThumbGate',
        terminal_title_stripped: 'Update LinkedIn profile details',
        tokens: { hp_group: 'secret-token-value' },
      }],
    },
  });
  assert.equal(
    line,
    '  omp state=working cwd=/Users/example/ThumbGate title=Update LinkedIn profile details',
  );
  assert.equal(line.includes('secret-token-value'), false);
});

test('still reads an older top-level agents array', () => {
  const line = formatHerdrCensus({
    agents: [{ id: 'pane-1', state: 'idle', cwd: '/tmp/repo', terminal_title: 'idle pane' }],
  });
  assert.equal(line, '  pane-1 state=idle cwd=/tmp/repo title=idle pane');
});

test('says none when the list is empty', () => {
  assert.equal(formatHerdrCensus({ result: { agents: [] } }), '  none');
  assert.equal(formatHerdrCensus({}), '  none');
});
