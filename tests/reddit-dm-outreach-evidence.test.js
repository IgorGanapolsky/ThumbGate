const test = require('node:test');
const assert = require('node:assert/strict');

const {
  markContacted,
  parseRedditComposeResponse,
} = require('../scripts/reddit-dm-outreach');

test('Reddit HTTP 200 responses count only when the provider body has no API errors', () => {
  assert.throws(
    () => parseRedditComposeResponse(200, JSON.stringify({
      json: { errors: [['USER_DOESNT_EXIST', 'that user does not exist', 'to']] },
    })),
    /rejected the message/
  );
  assert.throws(
    () => parseRedditComposeResponse(200, '<html>not-json</html>'),
    /invalid JSON/
  );

  const accepted = parseRedditComposeResponse(200, JSON.stringify({ json: { errors: [] } }));
  assert.equal(accepted.statusCode, 200);
  assert.match(accepted.responseSha256, /^[a-f0-9]{64}$/);
});

test('Reddit outreach refuses to mark contacted without a send receipt', () => {
  assert.throws(
    () => markContacted({ to: 'game-of-kton' }, {
      advanceLead: () => ({ unchanged: false }),
      timestamp: '2026-07-15T20:00:00.000Z',
    }),
    /send receipt reference is required/
  );
});

test('Reddit outreach passes provider-backed send evidence to the sales pipeline', () => {
  let captured = null;
  const result = markContacted({ to: 'game-of-kton' }, {
    advanceLead: (payload) => {
      captured = payload;
      return { unchanged: false };
    },
    timestamp: '2026-07-15T20:00:00.000Z',
    evidenceRef: 'reddit:compose:http-200:2026-07-15T20:00:00.000Z:u/game-of-kton',
  });

  assert.equal(result.leadId, 'reddit_game_of_kton_r_cursor');
  assert.equal(result.unchanged, false);
  assert.equal(captured.stage, 'contacted');
  assert.equal(captured.evidenceKind, 'platform_send_receipt');
  assert.equal(captured.evidenceSource, 'reddit_compose_api');
  assert.equal(
    captured.evidenceRef,
    'reddit:compose:http-200:2026-07-15T20:00:00.000Z:u/game-of-kton'
  );
});

test('unmapped Reddit recipients are not forced into the pipeline', () => {
  const result = markContacted({ to: 'not-in-pipeline' }, {
    advanceLead: () => {
      throw new Error('should not be called');
    },
  });

  assert.equal(result, null);
});
