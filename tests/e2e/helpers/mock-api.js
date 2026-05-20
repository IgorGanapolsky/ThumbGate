const path = require('path');
const fs = require('fs');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

async function mockDashboardApis(page, overrides = {}) {
  const dashboard = overrides.dashboard || loadFixture('dashboard.json');
  const feedbackStats = overrides.feedbackStats || loadFixture('feedback-stats.json');
  const timeline = overrides.timeline || loadFixture('timeline-search.json');
  const lessons = overrides.lessons || loadFixture('lessons-search.json');

  await page.route(/\/v1\/dashboard(\?|$)/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dashboard) }),
  );
  await page.route(/\/v1\/dashboard\/render-spec/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ blocks: [] }) }),
  );
  await page.route(/\/v1\/dashboard\/review-state/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ since: null }) }),
  );
  await page.route(/\/v1\/feedback\/stats/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(feedbackStats) }),
  );
  await page.route(/\/v1\/search/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(timeline) }),
  );
  await page.route(/\/v1\/lessons\/search/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lessons) }),
  );
  await page.route(/\/v1\/events/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  );
  await page.route(/\/v1\/dpo\/export/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: [] }) }),
  );
}

module.exports = { mockDashboardApis, loadFixture };
