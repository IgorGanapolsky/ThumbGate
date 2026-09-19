'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  IdeaBrowserConnector,
  ToolTier,
  DEFAULT_READ_ONLY_TOOLS,
  DEFAULT_MUTATING_TOOLS,
} = require('../src/integrations/ideabrowser-connector');

test('IdeaBrowserConnector initializes with default tools and options', () => {
  const customHandler = async () => ({ custom: true });
  const connector = new IdeaBrowserConnector({
    handlers: {
      get_page_content: customHandler,
      click_element: customHandler,
    },
  });
  assert.equal(connector.baseUrl, 'https://api.ideabrowser.com/v1');
  assert.equal(connector.failClosed, true);

  for (const tool of DEFAULT_READ_ONLY_TOOLS) {
    assert.equal(connector.classifyTool(tool), ToolTier.READ_ONLY);
  }

  for (const tool of DEFAULT_MUTATING_TOOLS) {
    assert.equal(connector.classifyTool(tool), ToolTier.MUTATING);
  }
});

test('IdeaBrowserConnector fails closed: unknown tools default to mutating', () => {
  const connector = new IdeaBrowserConnector();
  assert.equal(connector.classifyTool('unknown_custom_action'), ToolTier.MUTATING);
  assert.equal(connector.classifyTool('some_future_ai_tool'), ToolTier.MUTATING);
});

test('registerTool validates arguments and registers tool', () => {
  const connector = new IdeaBrowserConnector();
  assert.throws(() => connector.registerTool('', () => {}), /Tool name must be a non-empty string/);
  assert.throws(() => connector.registerTool('valid', 'not_a_func'), /Tool handler must be a function/);

  connector.registerTool('custom_ro', async () => 'data', ToolTier.READ_ONLY);
  assert.equal(connector.classifyTool('custom_ro'), ToolTier.READ_ONLY);

  connector.registerTool('custom_mutating', async () => 'done');
  assert.equal(connector.classifyTool('custom_mutating'), ToolTier.MUTATING);
});

test('getCredentials redacts keys and prevents plaintext leakage', () => {
  const connectorNoKey = new IdeaBrowserConnector({ apiKey: null });
  assert.deepEqual(connectorNoKey.getCredentials(), {
    hasKey: false,
    source: 'none',
    maskedKey: null,
  });

  const connectorWithKey = new IdeaBrowserConnector({ apiKey: 'sk_live_12345678abcdef' });
  const creds = connectorWithKey.getCredentials();
  assert.equal(creds.hasKey, true);
  assert.equal(creds.source, 'env_or_options');
  assert.ok(creds.maskedKey.includes('[REDACTED:stripe_live_secret]'));
  assert.ok(!creds.maskedKey.includes('sk_live_12345678abcdef'));
});

test('executeTool executes read-only tool without interdiction event', async () => {
  let interdictEmitted = false;
  const connector = new IdeaBrowserConnector();
  connector.on('interdict', () => {
    interdictEmitted = true;
  });

  const result = await connector.executeTool('get_page_content', { selector: 'body' });
  assert.equal(interdictEmitted, false);
  assert.equal(result.tool, 'get_page_content');
});

test('executeTool emits interdiction event for mutating tool and executes', async () => {
  const interdictions = [];
  const connector = new IdeaBrowserConnector();
  connector.on('interdict', (evt) => {
    interdictions.push(evt);
  });

  const result = await connector.executeTool('click_element', { selector: '#submit-btn' });
  assert.equal(interdictions.length, 1);
  assert.equal(interdictions[0].name, 'click_element');
  assert.equal(result.tool, 'click_element');
});

test('executeTool throws error if mutating tool fails pre-action gate check', async () => {
  const connector = new IdeaBrowserConnector();
  await assert.rejects(
    async () => {
      await connector.executeTool('submit_form', { formId: 'login' }, { blocked: true });
    },
    {
      code: 'GATE_INTERDICTED',
      message: /blocked by pre-action gate/,
    }
  );
});

test('executeTool enforces domain allowlist on mutating actions', async () => {
  const connectorNoAllowlist = new IdeaBrowserConnector();
  assert.equal(connectorNoAllowlist.isAllowedDomain('https://anywhere.com'), true);
  assert.equal(connectorNoAllowlist.isAllowedDomain(''), true);

  const connector = new IdeaBrowserConnector({
    allowedDomains: ['example.com', 'app.thumbgate.ai'],
  });

  assert.equal(connector.isAllowedDomain(''), false);
  assert.equal(connector.isAllowedDomain('example.com'), true);
  assert.equal(connector.isAllowedDomain('https://example.com/checkout'), true);
  assert.equal(connector.isAllowedDomain('not a valid url:::'), false);

  // Allowed domain execution
  const res = await connector.executeTool('navigate_url', { url: 'https://example.com/checkout' });
  assert.equal(res.tool, 'navigate_url');

  // Forbidden domain execution via params.url
  await assert.rejects(
    async () => {
      await connector.executeTool('navigate_url', { url: 'https://evil.com/phishing' });
    },
    {
      code: 'DOMAIN_INTERDICTED',
      message: /Domain not allowed/,
    }
  );

  // Forbidden domain execution via context.url
  await assert.rejects(
    async () => {
      await connector.executeTool('click_element', {}, { url: 'https://evil.com/phishing' });
    },
    {
      code: 'DOMAIN_INTERDICTED',
      message: /Domain not allowed/,
    }
  );

  // Configured empty allowedDomains fails closed
  const connectorEmptyAllowlist = new IdeaBrowserConnector({
    allowedDomains: [],
  });
  assert.equal(connectorEmptyAllowlist.isAllowedDomain('https://example.com'), false);
  await assert.rejects(
    async () => {
      await connectorEmptyAllowlist.executeTool('click_element', {}, { url: 'https://example.com' });
    },
    {
      code: 'DOMAIN_INTERDICTED',
      message: /Domain not allowed/,
    }
  );
});

test('executeTool redacts sensitive values from interdiction events', async () => {
  const events = [];
  const connector = new IdeaBrowserConnector();
  connector.on('interdict', (evt) => {
    events.push(evt);
  });

  await connector.executeTool(
    'fill_form',
    { password: 'super_secret_password', apiKey: 'sk_live_abcdef123456789' },
    { sessionToken: 'sk_test_987654321fedcba' }
  );

  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.name, 'fill_form');
  assert.ok(event.params.apiKey.includes('[REDACTED:stripe_live_secret]'));
  assert.ok(!event.params.apiKey.includes('sk_live_abcdef123456789'));
  assert.ok(event.context.sessionToken.includes('[REDACTED:stripe_test_secret]'));
  assert.ok(!event.context.sessionToken.includes('sk_test_987654321fedcba'));
});

test('executeTool throws error if unregistered mutating tool is called', async () => {
  const connector = new IdeaBrowserConnector();
  await assert.rejects(
    async () => {
      await connector.executeTool('non_existent_tool', {});
    },
    /IdeaBrowser tool "non_existent_tool" not found/
  );
});
