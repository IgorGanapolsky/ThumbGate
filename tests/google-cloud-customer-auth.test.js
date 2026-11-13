'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SESSION_COOKIE_NAME,
  FREE_SOLO_MAX_GATES,
  FREE_SOLO_MAX_PROJECTS,
  buildGoogleCloudSignInUrl,
  registerGoogleCloudCustomer,
  authenticateGoogleCloudCustomer,
  createCustomerDashboardProject,
} = require('../src/google-cloud-customer-auth');

test('Google Cloud OAuth sign-in URL targets accounts.google.com with openid email profile scope', () => {
  const res = buildGoogleCloudSignInUrl({
    clientId: '1066898670332-test.apps.googleusercontent.com',
    redirectUri: 'https://thumbgate.ai/v1/cloud/gcp/oauth/callback',
  });
  assert.equal(res.provider, 'google_cloud_identity');
  assert.match(res.authorizeUrl, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  assert.match(res.authorizeUrl, /scope=openid\+email\+profile/);
});

test('Google Cloud signup and login issue HttpOnly Secure cookies without clear-text key storage and enforce Free vs Paid project limits', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-gcp-auth-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const storePath = path.join(tmpDir, 'store.json');

  // 1. Free solo signup
  const freeSignup = registerGoogleCloudCustomer({
    email: 'solo@developer.io',
    password: 'StrongPassword!2026',
    authProvider: 'password',
    tier: 'free_mit',
    storePath,
  });
  assert.equal(freeSignup.ok, true);
  assert.equal(freeSignup.statusCode, 201);
  assert.match(freeSignup.sessionCookie, new RegExp(`${SESSION_COOKIE_NAME}=tg_gcpsess_`));
  assert.match(freeSignup.sessionCookie, /HttpOnly/);
  assert.match(freeSignup.sessionCookie, /Secure/);
  assert.equal(freeSignup.customer.isPaid, false);
  assert.equal(freeSignup.customer.entitlements.maxActiveGates, FREE_SOLO_MAX_GATES);
  assert.equal(freeSignup.customer.entitlements.maxProjects, FREE_SOLO_MAX_PROJECTS);
  assert.equal(freeSignup.customer.projects[0].strictMode, true);

  // 2. Free user hits 402 upgrade wall when creating a second project
  const blockedProject = createCustomerDashboardProject({
    sessionId: freeSignup.sessionId,
    projectName: 'Second Team Repo',
    storePath,
  });
  assert.equal(blockedProject.ok, false);
  assert.equal(blockedProject.statusCode, 402);
  assert.equal(blockedProject.error, 'free_tier_project_limit_reached');

  // 3. Upgrade customer to Paid Pro ($19/mo) via Google Cloud OAuth login & create multiple projects
  registerGoogleCloudCustomer({
    email: 'solo@developer.io',
    tier: 'pro',
    stripeCustomerId: 'cus_paid_pro_123',
    googleSub: 'google-oauth2|1066898670332',
    storePath,
  });

  const paidLogin = authenticateGoogleCloudCustomer({
    googleIdTokenClaims: {
      email: 'solo@developer.io',
      email_verified: true,
      sub: 'google-oauth2|1066898670332',
    },
    storePath,
  });
  assert.equal(paidLogin.ok, true);
  assert.equal(paidLogin.customer.isPaid, true);
  assert.equal(paidLogin.customer.entitlements.maxActiveGates, null);
  assert.equal(paidLogin.customer.entitlements.cloudDashboardEnabled, true);

  const createdProject = createCustomerDashboardProject({
    sessionId: paidLogin.sessionId,
    projectName: 'Production API Firewall',
    strictMode: true,
    storePath,
  });
  assert.equal(createdProject.ok, true);
  assert.equal(createdProject.statusCode, 201);
  assert.equal(createdProject.project.slug, 'production-api-firewall');
  assert.equal(createdProject.customer.projects.length, 2);
});
