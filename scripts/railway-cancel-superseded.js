#!/usr/bin/env node
'use strict';

// Cancel Railway deployments that a newer deploy has already superseded.
//
// Why: the production service has a volume at /data and one replica, so Railway hands the volume
// from one deployment to the next and runs queued deployments one at a time, in order. On
// 2026-11-24 and 2026-11-25 each handoff took up to an hour, while main took a push every few
// minutes, so 15+ deployments sat QUEUED and production ran hours behind main (deployment
// d3e76f6e built at 15:53Z and only started at 19:01Z). Every queued deploy except the newest is
// wasted work: it will be replaced right after it goes live.
//
// Run right after `railway up` in .github/workflows/deploy-railway.yml. It keeps the newest
// waiting deployment and anything already DEPLOYING (mid-handoff), and cancels the rest.
// Best effort: it prints what it did and always exits 0, so it can never block a deploy.
//
// Env: RAILWAY_API_TOKEN (account/team token) or RAILWAY_TOKEN (project token), RAILWAY_PROJECT_ID,
// RAILWAY_ENVIRONMENT_ID, and RAILWAY_SERVICE (service id or name).

const ENDPOINT = 'https://backboard.railway.com/graphql/v2';
// States a deployment sits in before it gets the volume. DEPLOYING is left alone: it already has it.
const SUPERSEDABLE = new Set(['QUEUED', 'WAITING', 'INITIALIZING', 'BUILDING']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authHeaders(env) {
  if (env.RAILWAY_API_TOKEN) return { Authorization: `Bearer ${env.RAILWAY_API_TOKEN}` };
  if (env.RAILWAY_TOKEN) return { 'Project-Access-Token': env.RAILWAY_TOKEN };
  return null;
}

async function gql(fetchFn, headers, query, variables) {
  const res = await fetchFn(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || (body.errors && body.errors.length)) {
    const message = body.errors && body.errors[0] && body.errors[0].message;
    throw new Error(`Railway API ${res.status}${message ? `: ${message}` : ''}`);
  }
  return body.data;
}

async function resolveServiceId(fetchFn, headers, projectId, service) {
  if (UUID_RE.test(service)) return service;
  const data = await gql(fetchFn, headers,
    'query($id: String!) { project(id: $id) { services { edges { node { id name } } } } }',
    { id: projectId });
  const match = ((data.project && data.project.services && data.project.services.edges) || [])
    .map((edge) => edge.node)
    .find((node) => node && node.name === service);
  if (!match) throw new Error(`service "${service}" not found in project`);
  return match.id;
}

/** Ids to cancel: every supersedable deployment except the newest one. */
function pickSuperseded(deployments = []) {
  const waiting = deployments
    .filter((d) => d && SUPERSEDABLE.has(d.status))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return waiting.slice(1).map((d) => d.id);
}

async function cancelSuperseded({ env = process.env, fetchFn = globalThis.fetch, log = console.log } = {}) {
  const headers = authHeaders(env);
  const { RAILWAY_PROJECT_ID: projectId, RAILWAY_ENVIRONMENT_ID: environmentId, RAILWAY_SERVICE: service } = env;
  if (!headers || !projectId || !environmentId || !service) {
    log('cancel-superseded: skipped (missing Railway token, project, environment or service)');
    return { cancelled: [], skipped: 'config' };
  }
  const serviceId = await resolveServiceId(fetchFn, headers, projectId, service);
  const data = await gql(fetchFn, headers,
    'query($input: DeploymentListInput!) { deployments(first: 50, input: $input) { edges { node { id status createdAt } } } }',
    { input: { projectId, environmentId, serviceId } });
  const deployments = ((data.deployments && data.deployments.edges) || []).map((edge) => edge.node);
  const ids = pickSuperseded(deployments);
  const cancelled = [];
  for (const id of ids) {
    try {
      await gql(fetchFn, headers, 'mutation($id: String!) { deploymentCancel(id: $id) }', { id });
      cancelled.push(id);
    } catch (err) {
      log(`cancel-superseded: could not cancel ${id}: ${err.message}`);
    }
  }
  log(`cancel-superseded: ${deployments.filter((d) => SUPERSEDABLE.has(d.status)).length} waiting, cancelled ${cancelled.length}${cancelled.length ? ` (${cancelled.join(', ')})` : ''}`);
  return { cancelled };
}

module.exports = { cancelSuperseded, pickSuperseded, authHeaders, SUPERSEDABLE };

if (require.main === module) {
  cancelSuperseded().catch((err) => {
    console.log(`cancel-superseded: skipped after error: ${err.message}`);
  }).finally(() => { process.exitCode = 0; });
}
