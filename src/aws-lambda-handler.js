'use strict';

/**
 * AWS Lambda HTTP API v2 Handler for ThumbGate Cloud SaaS (`thumbgate.ai`)
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  CURATED_THREAT_PACKS,
  CLOUD_SAAS_TIERS,
  interceptAgentRequest,
  buildCloudIntegrationGuideMarkdown,
  calculateCloudSaasEconomics,
  evaluateEntireCiTrailAndProjectSync,
  buildRlhfDpoTrainingPairFromInterception,
  buildFourPillarPositioningMatrix,
  syncTeamPolicyAndThreatPacks,
  ingestEnterpriseCloudSinkBatch,
  getCloudCustomerPortalSession,
  manageCloudSubscription,
  submitCloudPortalFeedbackAndFeatureRequest,
  startSsoAuthorizationFlow,
  buildMacAndLinuxInstallerScript,
  buildWindowsInstallerScript,
  buildHomebrewFormulaRuby,
  registerCommissionOnlyBdmDeal,
  calculateIrashTechTeamAndTokenRoi,
  evaluateSkillUpDeclarativeEvalLoop,
  convertSkillObservationToCandidateCase,
  evaluateRachelWoodsCraftAndPlaybookMiddleManagerGate,
  getSkillsShWellKnownSkillMarkdown,
  buildSkillsShWellKnownDiscoveryIndex,
  evaluateHerdrOmpPoolsideGitButlerSwarmGate,
  evaluateBrowserOsNeoProductivityGate,
  evaluateRadwareAgenticApiRiskFirewall,
  buildOneShotWellKnownReceiptsManifest,
  evaluateOneShotAgentGatewayAndSignedReceiptSteal,
  evaluateGoogleCloudSaasAndAiUltraCreditsFallback,
  evaluateAlgoverseResearchMonetizationGate,
  evaluateApolloAgentGtmConnectorSteal,
} = require('./cloud-token-firewall');

const CLOUD_PORTAL_HTML_PATH = path.resolve(__dirname, '../public/cloud.html');

function extractBearerToken(headers = {}) {
  const auth = String(headers.authorization || headers.Authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}

function textResponse(statusCode, contentType, body) {
  return {
    statusCode,
    headers: { 'Content-Type': contentType },
    body,
  };
}

function isPortalHtmlPath(rawPath) {
  return rawPath === '/cloud'
    || rawPath === '/portal'
    || rawPath === '/cloud.html'
    || /^\/(?:cloud\/u|u)\/[a-zA-Z0-9._-]+$/.test(rawPath);
}

const GET_ROUTE_HANDLERS = {
  '/.well-known/agent-skills/index.json': ({ appOrigin }) =>
    jsonResponse(200, buildSkillsShWellKnownDiscoveryIndex({ appOrigin })),
  '/.well-known/skills/index.json': ({ appOrigin }) =>
    jsonResponse(200, buildSkillsShWellKnownDiscoveryIndex({ appOrigin })),
  '/.well-known/thumbgate-receipts.json': ({ appOrigin }) =>
    jsonResponse(200, buildOneShotWellKnownReceiptsManifest({ appOrigin })),
  '/.well-known/oneshot-receipts.json': ({ appOrigin }) =>
    jsonResponse(200, buildOneShotWellKnownReceiptsManifest({ appOrigin })),
  '/Formula/thumbgate.rb': ({ appOrigin }) =>
    textResponse(200, 'text/plain; charset=utf-8', buildHomebrewFormulaRuby({ version: '1.40.0', apiBaseUrl: appOrigin })),
  '/install/homebrew.rb': ({ appOrigin }) =>
    textResponse(200, 'text/plain; charset=utf-8', buildHomebrewFormulaRuby({ version: '1.40.0', apiBaseUrl: appOrigin })),
  '/install.sh': ({ appOrigin }) =>
    textResponse(200, 'text/x-shellscript; charset=utf-8', buildMacAndLinuxInstallerScript({ apiBaseUrl: appOrigin })),
  '/install/macos.command': ({ appOrigin }) =>
    textResponse(200, 'text/x-shellscript; charset=utf-8', buildMacAndLinuxInstallerScript({ apiBaseUrl: appOrigin })),
  '/install/linux.sh': ({ appOrigin }) =>
    textResponse(200, 'text/x-shellscript; charset=utf-8', buildMacAndLinuxInstallerScript({ apiBaseUrl: appOrigin })),
  '/install.ps1': ({ appOrigin }) =>
    textResponse(200, 'text/plain; charset=utf-8', buildWindowsInstallerScript({ apiBaseUrl: appOrigin })),
  '/install/windows.bat': ({ appOrigin }) =>
    textResponse(200, 'text/plain; charset=utf-8', buildWindowsInstallerScript({ apiBaseUrl: appOrigin })),
  '/v1/cloud/sso/authorize': ({ query, appOrigin }) => {
    const sso = startSsoAuthorizationFlow({
      provider: query.provider || 'github',
      email: query.email || '',
      cliPort: query.cli_port || query.cliPort || '',
      redirectUri: query.redirect_uri || '',
      appOrigin,
    });
    return { statusCode: 302, headers: { Location: sso.redirectUrl, 'Cache-Control': 'no-store' }, body: '' };
  },
  '/v1/cloud/portal/session': ({ query, token }) =>
    jsonResponse(200, getCloudCustomerPortalSession({ apiKey: query.apiKey || token, email: query.email || '', tierId: query.tierId || '' })),
  '/v1/cloud/threat-packs': () =>
    jsonResponse(200, { ok: true, packs: CURATED_THREAT_PACKS }),
  '/v1/cloud/policy-sync': ({ query, token }) =>
    jsonResponse(200, syncTeamPolicyAndThreatPacks({ orgId: query.orgId || token || 'org_default' })),
  '/v1/cloud/positioning': () =>
    jsonResponse(200, buildFourPillarPositioningMatrix()),
  '/v1/cloud/roi-calculator': ({ query }) =>
    jsonResponse(200, calculateIrashTechTeamAndTokenRoi(query)),
  '/v1/cloud/calculator': ({ query }) =>
    jsonResponse(200, calculateCloudSaasEconomics(query)),
  '/v1/cloud/integration-guide.md': ({ query, token, appOrigin }) =>
    textResponse(200, 'text/markdown; charset=utf-8', buildCloudIntegrationGuideMarkdown({
      apiKey: query.apiKey || token || 'tg_live_YOUR_API_KEY',
      tierId: query.tier || 'cloud_indie',
      apiBaseUrl: appOrigin,
    })),
};

async function handlePostRoute(rawPath, body, token, appOrigin) {
  switch (rawPath) {
    case '/v1/cloud/portal/demo-intercept': {
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
      return jsonResponse(200, { ok: true, interceptResult, session });
    }
    case '/v1/cloud/portal/subscription':
      return jsonResponse(200, manageCloudSubscription({
        tenantKey: body.tenantKey || token || 'anonymous',
        action: body.action || 'status',
        targetTierId: body.targetTierId || 'cloud_startup',
        customerEmail: body.customerEmail || '',
        appOrigin,
      }));
    case '/v1/cloud/portal/feedback': {
      const fb = submitCloudPortalFeedbackAndFeatureRequest(body);
      return jsonResponse(fb.statusCode || 201, fb);
    }
    case '/v1/cloud/policy-sync':
      return jsonResponse(200, syncTeamPolicyAndThreatPacks({ ...body, action: 'update' }));
    case '/v1/cloud/playbook/craft':
      return jsonResponse(200, evaluateRachelWoodsCraftAndPlaybookMiddleManagerGate(body));
    case '/v1/cloud/skill-up/eval':
      return jsonResponse(200, evaluateSkillUpDeclarativeEvalLoop(body));
    case '/v1/cloud/skill-up/observation': {
      const obs = convertSkillObservationToCandidateCase(body);
      return jsonResponse(obs.statusCode || 200, obs);
    }
    case '/v1/cloud/swarm/herdr-gitbutler':
      return jsonResponse(200, evaluateHerdrOmpPoolsideGitButlerSwarmGate(body));
    case '/v1/cloud/browseros-neo/gate':
      return jsonResponse(200, evaluateBrowserOsNeoProductivityGate(body));
    case '/v1/cloud/radware-agent-risk/gate':
      return jsonResponse(200, evaluateRadwareAgenticApiRiskFirewall(body));
    case '/v1/cloud/oneshot/gate':
      return jsonResponse(200, evaluateOneShotAgentGatewayAndSignedReceiptSteal(body));
    case '/v1/cloud/gcp-ai-ultra/gate':
      return jsonResponse(200, evaluateGoogleCloudSaasAndAiUltraCreditsFallback(body));
    case '/v1/cloud/algoverse/gate':
      return jsonResponse(200, evaluateAlgoverseResearchMonetizationGate(body));
    case '/v1/cloud/apollo-gtm/gate':
      return jsonResponse(200, evaluateApolloAgentGtmConnectorSteal(body));
    case '/v1/cloud/bdm/register-deal': {
      const deal = registerCommissionOnlyBdmDeal(body);
      return jsonResponse(deal.statusCode || 201, deal);
    }
    case '/v1/cloud/ci-trail-eval':
      return jsonResponse(200, evaluateEntireCiTrailAndProjectSync(body));
    case '/v1/cloud/sink/ingest': {
      const res = ingestEnterpriseCloudSinkBatch({ batch: body });
      return jsonResponse(res.statusCode || 200, res);
    }
    case '/v1/cloud/dpo-sync':
      return jsonResponse(200, buildRlhfDpoTrainingPairFromInterception(body));
    case '/v1/cloud/intercept':
    case '/v1/firewall/intercept': {
      const defaultTier = token.startsWith('tg_startup_') ? 'cloud_startup' : 'cloud_indie';
      const res = await interceptAgentRequest({
        ...body,
        tenantKey: token || body.tenantKey || 'anonymous',
        tierId: body.tierId || defaultTier,
      });
      return jsonResponse(200, res);
    }
    default:
      return null;
  }
}

async function handler(event = {}) {
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const rawPath = event.rawPath || event.path || '/';
  const headers = event.headers || {};
  const query = event.queryStringParameters || {};
  const appOrigin = process.env.THUMBGATE_PUBLIC_APP_ORIGIN || 'https://thumbgate.ai';
  const token = extractBearerToken(headers);

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

  if (method === 'GET' && isPortalHtmlPath(rawPath)) {
    const html = fs.existsSync(CLOUD_PORTAL_HTML_PATH)
      ? fs.readFileSync(CLOUD_PORTAL_HTML_PATH, 'utf8')
      : '<h1>ThumbGate Cloud Portal</h1>';
    return textResponse(200, 'text/html; charset=utf-8', html);
  }

  const wellKnownMatch = method === 'GET' && rawPath.match(/^\/\.well-known\/(?:agent-skills|skills)\/([a-z0-9-]+)\/SKILL\.md$/i);
  if (wellKnownMatch) {
    const md = getSkillsShWellKnownSkillMarkdown(wellKnownMatch[1]);
    if (md) return textResponse(200, 'text/markdown; charset=utf-8', md);
    return jsonResponse(404, { error: 'Skill not found' });
  }

  if (method === 'GET' && GET_ROUTE_HANDLERS[rawPath]) {
    return GET_ROUTE_HANDLERS[rawPath]({ query, token, appOrigin });
  }

  if (method === 'POST') {
    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch {
      return jsonResponse(400, { error: 'Invalid JSON request body' });
    }
    const postRes = await handlePostRoute(rawPath, body, token, appOrigin);
    if (postRes) return postRes;
  }

  return jsonResponse(200, {
    service: 'ThumbGate Cloud SaaS (AWS Serverless)',
    portalUrl: `${appOrigin}/cloud`,
    tiers: CLOUD_SAAS_TIERS,
  });
}

module.exports = { handler, extractBearerToken };
