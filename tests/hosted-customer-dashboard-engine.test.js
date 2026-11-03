const assert = require('node:assert');
const { HostedCustomerDashboardEngine } = require('../scripts/hosted-customer-dashboard-engine');

const engine = new HostedCustomerDashboardEngine();

console.log('Testing Hosted Customer Dashboard SSO & Authentication...');

// 1. Unauthenticated request renders login page
const unauthAuth = engine.authenticateSession('');
assert.strictEqual(unauthAuth.authenticated, false);
const loginHtml = engine.renderCustomerDashboard(unauthAuth);
assert.ok(loginHtml.includes('ThumbGate Customer Portal'));
assert.ok(loginHtml.includes('Enter SSO Token'));

// 2. Authenticated request with valid SSO token renders live project dashboard
const authResult = engine.authenticateSession('tg_sso_project12345');
assert.strictEqual(authResult.authenticated, true);
const dashboardHtml = engine.renderCustomerDashboard(authResult);
assert.ok(dashboardHtml.includes('ThumbGate Control Plane'));
assert.ok(dashboardHtml.includes('Connected Project:'));
assert.ok(dashboardHtml.includes('Pre-Action Checks'));
assert.ok(dashboardHtml.includes('Recent Interceptions'));

console.log('✅ HostedCustomerDashboardEngine tests passed');
