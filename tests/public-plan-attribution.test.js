const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('public plan links preserve source attribution without retired service campaigns', () => {
  for (const [file, label, expected] of [
    ['gaming-playbook.html', 'Get Pro', { pathname: '/checkout/pro', plan_id: 'pro', utm_source: 'gaming_playbook' }],
    ['codex-plugin.html', 'Compare free and Pro', { pathname: '/pricing', utm_source: 'codex', utm_medium: 'plugin_page', utm_campaign: 'codex_plan_comparison', cta_placement: 'plugin_page', surface: 'codex_plugin' }],
  ]) {
    const html = fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
    const anchor = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].find((match) => match[2] === label);
    assert.ok(anchor, `${file}: ${label}`);
    const url = new URL(anchor[1].replaceAll('&amp;', '&'), 'https://thumbgate.ai');
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(key === 'pathname' ? url.pathname : url.searchParams.get(key), value, `${file}: ${key}`);
    }
    assert.doesNotMatch(url.href, /sprint|diagnostic|teams_follow_on/i);
  }
});
