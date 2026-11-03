const assert = require('node:assert');
const { CueGovernanceEngine } = require('../scripts/cue-governance-engine');

const identities = {
  'user_1': { role: 'manager', team: 'Sales', location: 'NY', isAdmin: false },
  'user_2': { role: 'engineer', team: 'Core', location: 'SF', isAdmin: false },
  'user_3': { role: 'guest', team: 'External', location: 'Remote', isAdmin: false },
  'user_admin': { role: 'admin', team: 'Ops', location: 'Global', isAdmin: true },
};

const engine = new CueGovernanceEngine({ identityStore: identities });

// 1. Permission Filtering
console.log('Testing Permission Filtering...');
const contents = [
  { id: '1', text: 'Public News', requiredRole: 'guest' },
  { id: '2', text: 'Manager Strategy', requiredRole: 'manager' },
  { id: '3', text: 'Internal Tech Spec', requiredRole: 'engineer' },
];

const managerFiltered = engine.filterByPermission('user_1', contents);
assert.strictEqual(managerFiltered.length, 2, 'Manager should see Public + Strategy');

const engineerFiltered = engine.filterByPermission('user_2', contents);
assert.strictEqual(engineerFiltered.length, 2, 'Engineer should see Public + Tech Spec');

const guestFiltered = engine.filterByPermission('user_3', contents);
assert.strictEqual(guestFiltered.length, 1, 'Guest should see only Public');

const adminFiltered = engine.filterByPermission('user_admin', contents);
assert.strictEqual(adminFiltered.length, 3, 'Admin should see all');

// 2. Role-Based Layout
console.log('Testing Role-Based Layout...');
const managerLayout = engine.getRoleBasedLayout('user_1', 'normal');
assert.strictEqual(managerLayout.focus, 'Management');
assert.ok(managerLayout.priority.includes('Approvals'), 'Manager layout should prioritize Approvals');

const incidentLayout = engine.getRoleBasedLayout('user_1', 'incident_response');
assert.strictEqual(incidentLayout.focus, 'Urgency');
assert.ok(incidentLayout.priority.includes('Incident Log'), 'Incident layout should prioritize Incident Log');

// 3. Continuous Context
console.log('Testing Continuous Context...');
const searchCtx = { contextId: 'ctx_123', originalQuery: 'Revenue Q3', state: { resultId: 'res_456' } };
const convo = engine.bridgeSearchToConversation(searchCtx, 'Why did it drop in August?');
assert.ok(convo.mergedPrompt.includes('Revenue Q3'), 'Prompt should retain search query');
assert.strictEqual(convo.contextId, 'ctx_123');

// 4. SoR Action Bridge
console.log('Testing SoR Action Bridge...');
const action = engine.mapToSystemOfRecord('approve_leave', { employeeId: 'emp_789' });
assert.strictEqual(action.system, 'HRIS', 'Should map to HRIS');
assert.strictEqual(action.payload.employeeId, 'emp_789');

const invalidAction = engine.mapToSystemOfRecord('dance_party', {});
assert.strictEqual(invalidAction.error, 'Intent not mapped to any System of Record');

console.log('✅ CueGovernanceEngine tests passed');
