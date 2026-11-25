#!/usr/bin/env node
'use strict';

// Cancel Railway deployments that a newer deploy has already superseded.
//
// Why: the production service has a volume at /data and one replica, so Railway hands the volume
// from one deployment to the next and runs queued deployments one at a time, in order. On
// 2026-11-24 and 2026-11-25 each handoff took up to an hour, while main took a push every few
// minutes, so 15+ deployments sat QUEUED and production ran hours behind main (deployment
// d3e76f6e built at 15:53Z and only started at 19:01Z). Every queued deploy between the oldest
// (head of the queue) and the newest (main's tip) is wasted work: it would be replaced right
// after it goes live.
//
// Run right after `railway up` in .github/workflows/deploy-railway.yml. It keeps the oldest and
// the newest waiting deployments and anything already DEPLOYING (mid-handoff), and cancels the
// rest, so at most two deploys wait at any time.
// Best effort: it prints what it did and always exits 0, so it can never block a deploy.
//
// Env: RAILWAY_API_TOKEN (account/team token), RAILWAY_TOKEN or RAILWAY_PROJECT_TOKEN_FALLBACK (project
// token, tried in that order when the one before is rejected), RAILWAY_PROJECT_ID,
// RAILWAY_ENVIRONMENT_ID, and RAILWAY_SERVICE (service id or name).

const ENDPOINT = 'https://backboard.railway.com/graphql/v2';
// States a deployment sits in before it gets the volume. DEPLOYING is left alone: it already has it.
const SUPERSEDABLE = new Set(['QUEUED', 'WAITING', 'INITIALIZING', 'BUILDING']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every credential to try, best first. The deploy step falls back from a rejected account token to
 * the project token only inside its own shell, so this step gets the same fallback here.
 */
function credentialCandidates(env) {
  const out = [];
  if (env.RAILWAY_API_TOKEN) out.push({ Authorization: `Bearer ${env.RAILWAY_API_TOKEN}` });
  for (const token of [env.RAILWAY_TOKEN, env.RAILWAY_PROJECT_TOKEN_FALLBACK]) {
    if (token && !out.some((h) => h['Project-Access-Token'] === token)) out.push({ 'Project-Access-Token': token });
  }
  return out;
}

function authHeaders(env) {
  return credentialCandidates(env)[0] || null;
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

/**
 * Ids to cancel: every supersedable deployment except the oldest and the newest.
 *
 * The oldest waiting deploy holds the head of Railway's FIFO queue: it is the one Railway starts
 * when the volume frees up. Cancelling it (as the first version of this script did) put the
 * newest deploy back at the end of the line on every merge, so with main taking a push every
 * ~9 minutes and the handoff taking ~1h, nothing ever reached SUCCESS (2026-11-25 20:56-22:00Z).
 * Keeping the oldest lets it through; keeping the newest means main's tip deploys right after.
 */
function pickSuperseded(deployments = []) {
  const waiting = deployments
    .filter((d) => d && SUPERSEDABLE.has(d.status))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return waiting.slice(1, -1).map((d) => d.id);
}

async function cancelSuperseded({ env = process.env, fetchFn = globalThis.fetch, log = console.log } = {}) {
  const candidates = credentialCandidates(env);
  const { RAILWAY_PROJECT_ID: projectId, RAILWAY_ENVIRONMENT_ID: environmentId, RAILWAY_SERVICE: service } = env;
  if (!candidates.length || !projectId || !environmentId || !service) {
    log('cancel-superseded: skipped (missing Railway token, project, environment or service)');
    return { cancelled: [], skipped: 'config' };
  }
  let headers = null;
  let data = null;
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const serviceId = await resolveServiceId(fetchFn, candidate, projectId, service);
      data = await gql(fetchFn, candidate,
        'query($input: DeploymentListInput!) { deployments(first: 50, input: $input) { edges { node { id status createdAt } } } }',
        { input: { projectId, environmentId, serviceId } });
      headers = candidate;
      break;
    } catch (err) {
      lastError = err;
      log(`cancel-superseded: credential rejected, trying the next one (${err.message})`);
    }
  }
  if (!headers) throw lastError || new Error('no Railway credential worked');
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

module.exports = { cancelSuperseded, pickSuperseded, authHeaders, credentialCandidates, SUPERSEDABLE };

if (require.main === module) {
  cancelSuperseded().catch((err) => {
    console.log(`cancel-superseded: skipped after error: ${err.message}`);
  }).finally(() => { process.exitCode = 0; });
}
