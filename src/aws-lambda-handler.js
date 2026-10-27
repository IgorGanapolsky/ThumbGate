'use strict';

/**
 * AWS Lambda HTTP API v2 Handler for ThumbGate Cloud SaaS (`thumbgate.ai`)
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  CLOUD_SAAS_TIERS,
  interceptAgentRequest,
  buildCloudIntegrationGuideMarkdown,
  calculateCloudSaasEconomics,
  evaluateEntireCiTrailAndProjectSync,
  buildRlhfDpoTrainingPairFromInterception,
  buildFourPillarPositioningMatrix,
  ingestEnterpriseCloudSinkBatch,
  getCloudCustomerPortalSession,
  manageCloudSubscription,
  submitCloudPortalFeedbackAndFeatureRequest,
  startSsoAuthorizationFlow,
  buildMacAndLinuxInstallerScript,
  buildWindowsInstallerScript,
  buildHomebrewFormulaRuby,
} = require('./cloud-token-firewall');

const CLOUD_PORTAL_HTML_PATH = path.resolve(__dirname, '../public/cloud.html');

function extractBearerToken(headers = {}) {
  const auth = headers.authorization || headers.Authorization || '';
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function handler(event = {}) {
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const rawPath = event.rawPath || event.path || '/';
  const headers = event.headers || {};
  const query = event.queryStringParameters || {};
  const appOrigin = process.env.THUMBGATE_PUBLIC_APP_ORIGIN || 'https://thumbgate.ai';

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-ThumbGate-Signature',
      },
      body: '',
    };
  }

  if (method === 'GET' && (rawPath === '/cloud' || rawPath === '/portal' || rawPath === '/cloud.html')) {
    const html = fs.existsSync(CLOUD_PORTAL_HTML_PATH)
      ? fs.readFileSync(CLOUD_PORTAL_HTML_PATH, 'utf8')
      : '<h1>ThumbGate Cloud Portal</h1>';
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    };
  }

  if (method === 'GET' && (rawPath === '/Formula/thumbgate.rb' || rawPath === '/install/homebrew.rb')) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: buildHomebrewFormulaRuby({ version: '1.40.0', apiBaseUrl: appOrigin }),
    };
  }

  if (method === 'GET' && (rawPath === '/install.sh' || rawPath === '/install/macos.command' || rawPath === '/install/linux.sh')) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/x-shellscript; charset=utf-8' },
      body: buildMacAndLinuxInstallerScript({ apiBaseUrl: appOrigin }),
    };
  }

  if (method === 'GET' && (rawPath === '/install.ps1' || rawPath === '/install/windows.bat')) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: buildWindowsInstallerScript({ apiBaseUrl: appOrigin }),
    };
  }

  if (method === 'GET' && rawPath === '/v1/cloud/sso/authorize') {
    const sso = startSsoAuthorizationFlow({
      provider: query.provider || 'github',
      email: query.email || '',
      cliPort: query.cli_port || query.cliPort || '',
      redirectUri: query.redirect_uri || '',
      appOrigin,
    });
    return {
      statusCode: 302,
      headers: { Location: sso.redirectUrl, 'Cache-Control': 'no-store' },
      body: '',
    };
  }

  if (method === 'GET' && rawPath === '/v1/cloud/portal/session') {
    const session = getCloudCustomerPortalSession({
      apiKey: query.apiKey || extractBearerToken(headers),
      email: query.email || '',
      tierId: query.tierId || '',
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(session),
    };
  }

  if (method === 'POST' && rawPath === '/v1/cloud/portal/demo-intercept') {
    const body = event.body ? JSON.parse(event.body) : {};
    const tenantKey = body.apiKey || body.email || 'tg_indie_portal_demo';
    const interceptResult = await interceptAgentRequest({
      tenantKey,
      tierId: 'cloud_indie',
      sessionId: 'portal_demo_session',
      agentId: 'claude_code_agent',
      toolCall: { name: 'bash', arguments: { cmd: 'npm test' } },
      messages: [
        { role: 'system', content: 'You are an autonomous coding agent running in a strict verification loop.' },
        { role: 'system', content: 'You are an autonomous coding agent running in a strict verification loop.' },
        { role: 'user', content: 'Fix failing test suite.' },
      ],
    });
    const session = getCloudCustomerPortalSession({ apiKey: tenantKey, email: body.email || 'demo@thumbgate.ai' });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: true, interceptResult, session }),
    };
  }

  if (method === 'POST' && rawPath === '/v1/cloud/portal/subscription') {
    const body = event.body ? JSON.parse(event.body) : {};
    const sub = manageCloudSubscription({
      tenantKey: body.tenantKey || extractBearerToken(headers) || 'anonymous',
      action: body.action || 'status',
      targetTierId: body.targetTierId || 'cloud_startup',
      customerEmail: body.customerEmail || '',
      appOrigin,
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(sub),
    };
  }

  if (method === 'POST' && rawPath === '/v1/cloud/portal/feedback') {
    const body = event.body ? JSON.parse(event.body) : {};
    const fb = submitCloudPortalFeedbackAndFeatureRequest(body);
    return {
      statusCode: fb.statusCode || 201,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(fb),
    };
  }

  if (method === 'GET' && rawPath === '/v1/cloud/positioning') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(buildFourPillarPositioningMatrix()),
    };
  }

  if (method === 'POST' && rawPath === '/v1/cloud/ci-trail-eval') {
    const body = event.body ? JSON.parse(event.body) : {};
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(evaluateEntireCiTrailAndProjectSync(body)),
    };
  }

  if (method === 'POST' && rawPath === '/v1/cloud/sink/ingest') {
    const body = event.body ? JSON.parse(event.body) : {};
    const result = ingestEnterpriseCloudSinkBatch({ batch: body });
    return {
      statusCode: result.statusCode || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(result),
    };
  }

  if (method === 'POST' && rawPath === '/v1/cloud/dpo-sync') {
    const body = event.body ? JSON.parse(event.body) : {};
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(buildRlhfDpoTrainingPairFromInterception(body)),
    };
  }

  if (method === 'GET' && rawPath === '/v1/cloud/calculator') {
    const economics = calculateCloudSaasEconomics({
      indieSubscribers: query.indieSubscribers ?? 15,
      startupSubscribers: query.startupSubscribers ?? 20,
      architecture: query.architecture || 'serverless_lambda_dynamodb_sqs',
      developerMonthlyApiBillUsd: query.developerMonthlyApiBillUsd ?? 500,
      compactionReductionPct: query.compactionReductionPct ?? 42,
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(economics),
    };
  }

  if (method === 'GET' && rawPath === '/v1/cloud/integration-guide.md') {
    const apiKey = query.apiKey || extractBearerToken(headers) || 'tg_live_YOUR_API_KEY';
    const tierId = query.tier || 'cloud_indie';
    const markdown = buildCloudIntegrationGuideMarkdown({
      apiKey,
      tierId,
      apiBaseUrl: appOrigin,
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      body: markdown,
    };
  }

  if (method === 'POST' && (rawPath === '/v1/cloud/intercept' || rawPath === '/v1/firewall/intercept')) {
    const token = extractBearerToken(headers);
    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: 'Invalid JSON request body' }),
      };
    }

    const result = await interceptAgentRequest({
      tenantKey: token || body.tenantKey || 'anonymous',
      tierId: body.tierId || (token.startsWith('tg_startup_') ? 'cloud_startup' : 'cloud_indie'),
      sessionId: body.sessionId,
      agentId: body.agentId,
      provider: body.provider,
      model: body.model,
      toolCall: body.toolCall,
      messages: body.messages,
      toolOutput: body.toolOutput,
      maxLoopRepeats: body.maxLoopRepeats,
      webhookUrl: body.webhookUrl,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(result),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      service: 'ThumbGate Cloud SaaS (AWS Serverless)',
      portalUrl: `${appOrigin}/cloud`,
      tiers: CLOUD_SAAS_TIERS,
      endpoints: [
        'GET /cloud',
        'GET /Formula/thumbgate.rb',
        'GET /install.sh',
        'GET /install.ps1',
        'GET /v1/cloud/sso/authorize',
        'GET /v1/cloud/portal/session',
        'POST /v1/cloud/portal/subscription',
        'POST /v1/cloud/portal/feedback',
        'POST /v1/cloud/intercept',
        'GET /v1/cloud/positioning',
        'POST /v1/cloud/ci-trail-eval',
        'POST /v1/cloud/sink/ingest',
        'POST /v1/cloud/dpo-sync',
        'GET /v1/cloud/integration-guide.md',
        'GET /v1/cloud/calculator',
      ],
    }),
  };
}

module.exports = { handler };
