const { test, expect } = require('./helpers/agent-browser');
const { mockDashboardApis, loadFixture } = require('./helpers/mock-api');

test.beforeEach(async ({ page }) => {
  const dashboard = loadFixture('dashboard.json');
  dashboard.gates = [{
    id: 'local-only-git-writes',
    name: 'local-only-git-writes',
    pattern: 'git\\s+push',
    action: 'block',
    message: 'Keep repository writes local until the owner authorizes publication.',
    source: 'feedback',
    sourceLessonId: 'lesson-42',
    createdAt: '2026-11-12T12:00:00Z',
  }];
  dashboard.agentRegister = {};
  dashboard.gateFlowStats = {
    tracked: true,
    blockedToday: 2,
    blocked30Days: 7,
    allowed30Days: 11,
    blockedEntries: [{ timestamp: '2026-11-13T12:00:00Z', gateId: 'local-only-git-writes', toolName: 'Bash' }],
  };
  await mockDashboardApis(page, { dashboard });
  await page.goto('/dashboard#gates');
  await expect(page.getByRole('button', { name: /local-only-git-writes/ })).toBeVisible();
});

test('gate expands by mouse and keyboard with explanation, provenance and honest counters', async ({ page }) => {
  const button = page.getByRole('button', { name: /local-only-git-writes/ });
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  const panel = page.locator('#' + await button.getAttribute('aria-controls'));
  await expect(panel).toBeHidden();
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toContainText('Keep repository writes local');
  await expect(panel).toContainText('lesson-42');
  await expect(panel).toContainText('2026-11-12');
  await expect(panel).toContainText('Today: not tracked yet');
  await expect(panel).toContainText('30 days: not tracked yet');
  await expect(panel).toContainText('THUMBGATE_GATES_CONFIG');
  await expect(panel).toContainText('git\\s+push');
  await button.press('Enter');
  await expect(panel).toBeHidden();
  await button.press('Space');
  await expect(panel).toBeVisible();
});

test('each flow step exposes its explanation by mouse and keyboard', async ({ page }) => {
  const steps = page.locator('.flow-details [role="button"]');
  await expect(steps).toHaveCount(5);
  for (const step of await steps.all()) {
    await step.click();
    await expect(page.locator('#flowExplanation')).toBeVisible();
    await step.focus();
    await step.press('Enter');
    await expect(page.locator('#flowExplanation')).toHaveText(/.{40}/);
    await expect(step).toHaveAttribute('aria-expanded', 'true');
  }
  await page.getByRole('button', { name: 'PreToolUse Hook', exact: true }).click();
  await expect(page.locator('#flowExplanation')).toContainText('npx thumbgate doctor');
  await page.getByRole('button', { name: 'Gate Evaluation', exact: true }).click();
  await expect(page.locator('#flowExplanation')).toContainText('Active gates:');
  await expect(page.locator('#flowExplanation a')).toHaveAttribute('href', '#gatesList');
  await page.getByRole('button', { name: 'BLOCK', exact: true }).click();
  await expect(page.locator('#flowExplanation')).toContainText('Recorded blocks today: 2');
  await expect(page.locator('#flowExplanation')).toContainText('Recorded blocks over 30 days: 7');
  await page.getByRole('link', { name: 'View recorded blocked entries' }).click();
  await expect(page.locator('#gateBlockedEntriesList')).toBeVisible();
  await expect(page.locator('#gateBlockedEntriesList')).toContainText('local-only-git-writes');
  await page.getByRole('button', { name: 'ALLOW', exact: true }).click();
  await expect(page.locator('#flowExplanation')).toContainText('Recorded allows over 30 days: 11');
});

test('flow counts never substitute lifetime totals for missing period data', async ({ page }) => {
  await page.evaluate(() => renderDashboardData({ gateStats: { blocked: 999, passed: 888 } }));
  await page.getByRole('button', { name: 'BLOCK', exact: true }).click();
  await expect(page.locator('#flowExplanation')).toContainText('today: not tracked yet');
  await expect(page.locator('#flowExplanation')).not.toContainText('999');
  await page.getByRole('button', { name: 'ALLOW', exact: true }).click();
  await expect(page.locator('#flowExplanation')).toContainText('30 days: not tracked yet');
  await expect(page.locator('#flowExplanation')).not.toContainText('888');
  await page.evaluate(() => renderDashboardData({ gateFlowStats: { tracked: false, incomplete: true } }));
  await page.getByRole('button', { name: 'BLOCK', exact: true }).click();
  await expect(page.locator('#flowExplanation')).toContainText('audit history is incomplete');
});

test('approval and logging gates retain their actions', async ({ page }) => {
  await page.evaluate(() => renderDashboardData({ gates: [{ name: 'approval-rule', action: 'approve' }, { name: 'logging-rule', action: 'log' }] }));
  await expect(page.getByRole('button', { name: 'approval-rule APPROVE' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'logging-rule LOG' })).toBeVisible();
  await expect(page.locator('#gatesList .gate-action')).not.toContainText(['WARN', 'WARN']);
});

test('an unavailable dashboard never reports a fabricated zero gate count', async ({ page }) => {
  await page.route(/\/v1\/dashboard(\?|$)/, route => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  await page.evaluate(async () => {
    document.getElementById('statGates').textContent = '—';
    await loadGates();
  });
  await expect(page.locator('#statGates')).toHaveText('Unavailable');
  await expect(page.locator('#gatesList')).toContainText('Failed to load dashboard');
});

test('empty Agent Register names the local data boundary and supported commands', async ({ page }) => {
  const register = page.locator('#agentRegisterList');
  await expect(register).toContainText('this dashboard');
  await expect(register).toContainText('Local hook events are not automatically uploaded');
  await expect(register).toContainText('npx thumbgate inventory --days=30 --json');
  await expect(register).toContainText('npx thumbgate dashboard --open');
});

test('gate metadata is escaped and missing provenance is explicit', async ({ page }) => {
  await page.evaluate(() => renderDashboardData({ gates: [{ name: '<img src=x onerror=alert(1)>', pattern: '<script>unsafe</script>', action: 'block' }] }));
  const button = page.locator('#gatesList button');
  await button.click();
  await expect(page.locator('#gatesList img, #gatesList script')).toHaveCount(0);
  await expect(page.locator('#gatesList')).toContainText('Source lesson/feedback: not recorded');
  await expect(page.locator('#gatesList')).toContainText('Date: not recorded');
});

test('all ten tabs render content and empty data gives actionable guidance', async ({ page }) => {
  await page.route('**/v1/dashboard/ai-inventory', route => route.fulfill({ json: { components: [] } }));
  await page.route('**/v1/enterprise/data-chat/status', route => route.fulfill({ json: {} }));
  await page.route('**/v1/search', route => route.fulfill({ json: { results: [] } }));
  await page.route('**/v1/chat', route => route.fulfill({ json: { answer: 'No account feedback recorded yet.' } }));
  for (const name of ['search', 'gates', 'team', 'enterprise', 'ai-inventory', 'generated', 'settings', 'templates', 'insights', 'export']) {
    await page.locator('.tabs .tab[onclick="switchTab(\'' + name + '\')"]').click();
    await expect(page.locator('#tab-' + name)).toBeVisible();
    await expect(page.locator('#tab-' + name + ' .loading')).toHaveCount(0);
    expect((await page.locator('#tab-' + name).innerText()).trim().length).toBeGreaterThan(30);
  }
  await page.evaluate(() => switchTab('search'));
  await page.locator('#searchQuery').fill('absent lesson');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('#searchResults')).toContainText('npx thumbgate search-lessons');
  await page.evaluate(() => switchTab('enterprise'));
  await page.locator('#enterpriseChatPrompt').fill('Which gates are active?');
  await page.locator('#enterpriseChatBtn').click();
  await expect(page.locator('#enterpriseChatAnswer')).toContainText('No account feedback recorded yet.');
  await page.evaluate(() => switchTab('ai-inventory'));
  await expect(page.locator('#aiInventoryComponents')).toContainText('npx thumbgate ai-inventory');
  await page.evaluate(() => switchTab('generated'));
  await expect(page.locator('#generatedViewCanvas')).toContainText('npx thumbgate dashboard --open');
  await page.evaluate(() => switchTab('insights'));
  await expect(page.locator('#pipelineFlow')).toContainText('npx thumbgate feedback');
  await page.evaluate(() => switchTab('export'));
  await page.getByRole('button', { name: /Download DPO Pairs/ }).click();
  await expect(page.locator('#exportStatus')).toContainText('No preference pairs');
  await expect(page.locator('#exportStatus')).toContainText('npx thumbgate feedback');
});
