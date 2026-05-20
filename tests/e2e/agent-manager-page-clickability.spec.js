const { test, expect } = require('@playwright/test');
const { mockDashboardApis } = require('./helpers/mock-api');

// Comprehensive clickability coverage for /agent-manager — the ICP landing
// page Anthropic's "Agent Manager" role lands on. Every nav link, every CTA
// in the bottom card, and every related-reading link is asserted to produce
// a real navigation. The page itself has no in-page state (no accordions,
// no tabs) — it's pure SEO + CTAs — so every click test is a navigation
// assertion.

test.describe('/agent-manager clickability — full link coverage', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardApis(page);
  });

  test('renders the headline and the "Built for the Agent Manager" pill', async ({ page }) => {
    await page.goto('/agent-manager');
    await expect(page.locator('.pill', { hasText: /Built for the Agent Manager/ })).toBeVisible();
    await expect(page.locator('h1')).toContainText('CLAUDE.md');
  });

  // --- nav (5 anchors) ---

  test('nav: clicking "ThumbGate" brand link navigates to /', async ({ page }) => {
    await page.goto('/agent-manager');
    await page.locator('nav a.brand', { hasText: 'ThumbGate' }).click();
    await page.waitForURL(/\/$/);
  });

  test('nav: clicking "Guide" navigates to /guide', async ({ page }) => {
    await page.goto('/agent-manager');
    await page.locator('nav a', { hasText: /^Guide$/ }).click();
    await page.waitForURL(/\/guide$/);
  });

  test('nav: clicking "Dashboard demo" navigates to /dashboard', async ({ page }) => {
    await page.goto('/agent-manager');
    await page.locator('nav a', { hasText: 'Dashboard demo' }).click();
    await page.waitForURL(/\/dashboard$/);
  });

  test('nav: clicking "Workflow Hardening Sprint" navigates to / with #workflow-sprint-intake', async ({ page }) => {
    await page.goto('/agent-manager');
    await page.locator('nav a', { hasText: 'Workflow Hardening Sprint' }).click();
    await page.waitForURL(/\/#workflow-sprint-intake$/);
  });

  test('nav: GitHub link has correct external href + opens in new tab', async ({ page }) => {
    await page.goto('/agent-manager');
    const ghLink = page.locator('nav a[href*="github.com/IgorGanapolsky/ThumbGate"]');
    await expect(ghLink).toHaveAttribute('target', '_blank');
    await expect(ghLink).toHaveAttribute('href', /github\.com\/IgorGanapolsky\/ThumbGate$/);
  });

  // --- primary CTAs in the bottom call-to-action card ---

  test('primary CTA "Start the Workflow Hardening Sprint" anchors to /#workflow-sprint-intake', async ({ page }) => {
    await page.goto('/agent-manager');
    await page.locator('a.cta', { hasText: /Start the Workflow Hardening Sprint/ }).click();
    await page.waitForURL(/\/#workflow-sprint-intake$/);
  });

  test('secondary CTA "Or start Pro at $19/mo" links to the Pro checkout with utm_medium=agent_manager_page', async ({ page }) => {
    await page.goto('/agent-manager');
    const cta = page.locator('a.secondary', { hasText: /Or start Pro at \$19\/mo/ });
    await expect(cta).toHaveAttribute('href', /\/checkout\/pro/);
    await expect(cta).toHaveAttribute('href', /utm_medium=agent_manager_page/);
    await expect(cta).toHaveAttribute('href', /plan_id=pro/);
  });

  // --- "Related reading" footer links (3) ---

  test('related reading: "ThumbGate for platform teams" navigates to /use-cases/platform-teams', async ({ page }) => {
    await page.goto('/agent-manager');
    await page.locator('a', { hasText: 'ThumbGate for platform teams' }).click();
    await page.waitForURL(/\/use-cases\/platform-teams$/);
  });

  test('related reading: "regulated workflows" navigates to /use-cases/regulated-workflows', async ({ page }) => {
    await page.goto('/agent-manager');
    await page.locator('a', { hasText: 'ThumbGate for regulated workflows' }).click();
    await page.waitForURL(/\/use-cases\/regulated-workflows$/);
  });

  test('related reading: "Orchestration vs enforcement" navigates to /compare/ai-experience-orchestration', async ({ page }) => {
    await page.goto('/agent-manager');
    await page.locator('a', { hasText: 'Orchestration vs enforcement' }).click();
    await page.waitForURL(/\/compare\/ai-experience-orchestration$/);
  });
});
