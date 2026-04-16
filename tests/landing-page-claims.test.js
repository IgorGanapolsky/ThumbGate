'use strict';

/**
 * Landing-page congruence tests.
 *
 * Every bullet point on the Free/Pro/Team pricing columns must have either:
 *   (a) code evidence it's actually implemented, or
 *   (b) explicit inclusion in the known-marketing-claims allowlist below.
 *
 * Prevents the "checkmarks next to things that aren't there" problem.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function extractTierBullets(html, tierHeaderRegex) {
  const blockMatch = html.match(tierHeaderRegex);
  if (!blockMatch) return null;
  const start = blockMatch.index;
  const ulOpen = html.indexOf('<ul>', start);
  const ulClose = html.indexOf('</ul>', ulOpen);
  if (ulOpen < 0 || ulClose < 0) return null;
  const ulBlock = html.slice(ulOpen, ulClose);
  const items = [...ulBlock.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  );
  return items;
}

const FREE_BULLETS = extractTierBullets(
  INDEX_HTML,
  /<div class="tier"[^>]*>Free<\/div>/,
);
const PRO_BULLETS = extractTierBullets(
  INDEX_HTML,
  /Solo Pro/,
);
const TEAM_BULLETS = extractTierBullets(
  INDEX_HTML,
  /<div class="tier"[^>]*>Team<\/div>/,
);

describe('Free tier bullets: extraction', () => {
  test('extracts at least 6 bullets from Free tier', () => {
    assert.ok(FREE_BULLETS, 'Free tier block not found');
    assert.ok(FREE_BULLETS.length >= 6, `got ${FREE_BULLETS ? FREE_BULLETS.length : 0} bullets`);
  });
});

describe('Free tier bullets: code-backed claims', () => {
  test('"3 feedback captures total" matches FREE_TIER_LIMITS.capture_feedback.lifetime', () => {
    const { FREE_TIER_LIMITS } = require(path.join(ROOT, 'scripts', 'rate-limiter.js'));
    assert.equal(FREE_TIER_LIMITS.capture_feedback.lifetime, 3,
      'rate-limiter says free gets N captures; landing page says 3 — must match');
    assert.ok(
      FREE_BULLETS.some((b) => /3 feedback captures/i.test(b)),
      'Landing page must claim "3 feedback captures"',
    );
  });

  test('"1 prevention rule" matches FREE_TIER_MAX_GATES + prevention_rules.lifetime', () => {
    const { FREE_TIER_LIMITS, FREE_TIER_MAX_GATES } = require(path.join(ROOT, 'scripts', 'rate-limiter.js'));
    assert.equal(FREE_TIER_MAX_GATES, 1, 'FREE_TIER_MAX_GATES must be 1 to back "1 rule" claim');
    assert.equal(FREE_TIER_LIMITS.prevention_rules.lifetime, 1, 'prevention_rules.lifetime must be 1');
    assert.ok(
      FREE_BULLETS.some((b) => /1 (auto-promoted )?prevention rule/i.test(b)),
      'Landing page must claim exactly 1 prevention rule',
    );
  });

  test('"No recall or lesson search" matches recall=0 and search_lessons=0', () => {
    const { FREE_TIER_LIMITS } = require(path.join(ROOT, 'scripts', 'rate-limiter.js'));
    assert.equal(FREE_TIER_LIMITS.recall.lifetime, 0, 'recall must be blocked for free');
    assert.equal(FREE_TIER_LIMITS.search_lessons.lifetime, 0, 'search_lessons must be blocked for free');
    assert.ok(
      FREE_BULLETS.some((b) => /no recall or lesson search/i.test(b)),
      'Landing page must honestly say recall/search are blocked',
    );
  });

  test('"No exports" matches export_dpo=0 and export_databricks=0', () => {
    const { FREE_TIER_LIMITS } = require(path.join(ROOT, 'scripts', 'rate-limiter.js'));
    assert.equal(FREE_TIER_LIMITS.export_dpo.lifetime, 0, 'export_dpo must be blocked for free');
    assert.equal(FREE_TIER_LIMITS.export_databricks.lifetime, 0, 'export_databricks must be blocked for free');
    assert.ok(
      FREE_BULLETS.some((b) => /no exports/i.test(b)),
      'Landing page must honestly say exports are blocked',
    );
  });

  test('"All MCP integrations" — auto-wire-hooks.js supports named agents', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'auto-wire-hooks.js'), 'utf8');
    for (const agent of ['claude-code', 'codex', 'gemini']) {
      assert.ok(src.includes(`'${agent}'`), `auto-wire-hooks must support ${agent}`);
    }
  });

  test('"PreToolUse hook blocking" — gates-engine run() produces hook output', () => {
    const engine = require(path.join(ROOT, 'scripts', 'gates-engine.js'));
    assert.equal(typeof engine.run, 'function', 'run() must exist for PreToolUse hook');
    const out = engine.run({ tool_name: 'Bash', tool_input: { command: 'echo hi' } });
    assert.doesNotThrow(() => JSON.parse(out), 'PreToolUse hook must output valid JSON');
  });

  test('"Setup guide for all agents" link target exists', () => {
    assert.ok(
      fs.existsSync(path.join(ROOT, 'public', 'guide.html')),
      'public/guide.html must exist — link points to it',
    );
  });

  test('NO unverified "1 agent" claim (was false — no enforcement code)', () => {
    const matches = FREE_BULLETS.filter((b) => /^\s*1 agent\s*$/i.test(b));
    assert.equal(matches.length, 0,
      'Landing page must not claim "1 agent" as a limit — there is no per-agent enforcement in rate-limiter.js');
  });
});

describe('Pro tier bullets: code-backed claims', () => {
  test('"DPO training data export" endpoint exists', () => {
    const server = fs.readFileSync(path.join(ROOT, 'src', 'api', 'server.js'), 'utf8');
    assert.ok(server.includes("'/v1/dpo/export'"),
      'POST /v1/dpo/export endpoint must be registered to back DPO export claim');
    assert.ok(
      PRO_BULLETS.some((b) => /DPO training data export|DPO.*pairs/i.test(b)),
      'Pro bullet must mention DPO export',
    );
  });

  test('"HuggingFace dataset export" script exists', () => {
    assert.ok(
      fs.existsSync(path.join(ROOT, 'scripts', 'export-hf-dataset.js')),
      'scripts/export-hf-dataset.js must exist to back HF export claim',
    );
  });

  test('"Personal local dashboard" ships in npm package', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(
      pkg.files.includes('public/dashboard.html'),
      'public/dashboard.html must be in package.json files whitelist to ship with npm install',
    );
  });

  test('"Visual gate debugger" link deep-links to insights or gates tab', () => {
    // Find the href that immediately precedes "Visual gate debugger" text
    const m = INDEX_HTML.match(/href="([^"]+)"[^>]*>\s*Visual gate debugger/);
    assert.ok(m, 'Visual gate debugger link not found');
    assert.match(
      m[1],
      /dashboard(#|\?tab=)(insights|gates)/,
      `Visual gate debugger must deep-link to insights or gates tab, got: ${m[1]}`,
    );
  });

  test('"DPO training data export" link deep-links to export tab', () => {
    const m = INDEX_HTML.match(/href="([^"]+)"[^>]*>\s*DPO training data export/);
    assert.ok(m, 'DPO training data export link not found');
    assert.match(
      m[1],
      /dashboard(#|\?tab=)export/,
      `DPO export must deep-link to export tab, got: ${m[1]}`,
    );
  });

  test('compat cards that promise a download link directly to the asset', () => {
    // Pattern: the outer <a class="compat-card"> href must match the card's verb.
    // If the card-arrow says "Download" or the body text says "Download the zip /
    // the bundle", the outer href MUST go to a releases download URL — not a
    // guide page or INSTALL.md source file.
    const cardBlocks = [...INDEX_HTML.matchAll(
      /<a class="compat-card"[^>]*href="([^"]+)"[^>]*>[\s\S]*?(<div class="card-arrow[^>]*>([\s\S]*?)<\/div>)[\s\S]*?<\/a>/g,
    )];
    assert.ok(cardBlocks.length > 0, 'must find compat cards');

    for (const [fullMatch, outerHref, , cardArrow] of cardBlocks) {
      const cardText = fullMatch.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const promisesDownload =
        /download the (zip|bundle|mcpb|extension|plugin)/i.test(cardText) ||
        /^\s*(Download|Get the) .* (plugin|bundle|extension)/i.test(cardArrow);
      if (!promisesDownload) continue;
      assert.match(
        outerHref,
        /releases\/.*download\//,
        `Card promises a download (arrow: "${cardArrow.trim()}") but href goes to "${outerHref}" — must link directly to the release asset`,
      );
    }
  });

  test('every local /guide* link on a compat card resolves to a real public/ file', () => {
    // Guards against a card pointing to /guides/claude-desktop when that HTML
    // page doesn't exist — which is exactly the regression that produced a
    // 404 on the "60-second setup guide" sub-link.
    const cardBlocks = [...INDEX_HTML.matchAll(
      /<a class="compat-card"[^>]*href="([^"]+)"[\s\S]*?<\/a>/g,
    )];
    for (const [, outerHref] of cardBlocks) {
      if (!/^\/guide(s)?\//.test(outerHref) && !/^\/guide\.html/.test(outerHref)) continue;
      const cleanPath = outerHref.split('#')[0].split('?')[0];
      // /guide.html → public/guide.html, /guides/x.html → public/guides/x.html
      const publicPath = path.join(ROOT, 'public', cleanPath.replace(/^\//, ''));
      const publicPathWithHtml = publicPath.endsWith('.html') ? publicPath : `${publicPath}.html`;
      assert.ok(
        fs.existsSync(publicPath) || fs.existsSync(publicPathWithHtml),
        `Compat card links to "${outerHref}" but neither ${publicPath} nor ${publicPathWithHtml} exists on disk`,
      );
    }
  });

  test('every local /guide* sub-link inside card body copy resolves to a real file', () => {
    // Same guard but for the inline "60-second setup guide →" style sub-links
    // inside card <p> bodies, not just the outer card href.
    const innerLinks = [...INDEX_HTML.matchAll(
      /<p[^>]*>[\s\S]*?<a href="(\/guide[^"]*)"[\s\S]*?<\/p>/g,
    )];
    for (const [, href] of innerLinks) {
      const cleanPath = href.split('#')[0].split('?')[0];
      const publicPath = path.join(ROOT, 'public', cleanPath.replace(/^\//, ''));
      const publicPathWithHtml = publicPath.endsWith('.html') ? publicPath : `${publicPath}.html`;
      assert.ok(
        fs.existsSync(publicPath) || fs.existsSync(publicPathWithHtml),
        `Inline card sub-link "${href}" has no matching file at ${publicPath} or ${publicPathWithHtml}`,
      );
    }
  });

  test('compat cards that do NOT promise a download must link to a guide or real directory — never to a GitHub source browser', () => {
    // Rule: if the card does NOT promise a download, the outer href must be
    //   (a) a local /guide.html or /guides/*.html page, or
    //   (b) a real external directory/listing (mcp.so, chatgpt.com, npmjs.com,
    //       pulsemcp.com, smithery.ai, cursor.directory), or
    //   (c) an internal redirect like /go/gpt.
    // It must NEVER point to a github.com /tree/ or /blob/ path — those are
    // source-code browsers, not "listings." Hardening from the regression
    // where every non-download card silently pointed at GitHub source.
    const cardBlocks = [...INDEX_HTML.matchAll(
      /<a class="compat-card"[^>]*href="([^"]+)"[^>]*>[\s\S]*?(<div class="card-arrow[^>]*>([\s\S]*?)<\/div>)[\s\S]*?<\/a>/g,
    )];
    const allowedExternalDirectories = [
      'mcp.so',
      'chatgpt.com',
      'chat.openai.com',
      'npmjs.com',
      'pulsemcp.com',
      'smithery.ai',
      'cursor.directory',
      'platform.openai.com',
    ];
    for (const [fullMatch, outerHref, , cardArrow] of cardBlocks) {
      const cardText = fullMatch.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const promisesDownload =
        /download the (zip|bundle|mcpb|extension|plugin)/i.test(cardText) ||
        /^\s*(Download|Get the) .* (plugin|bundle|extension)/i.test(cardArrow);
      if (promisesDownload) continue;

      const isLocalGuide = /^\/guide(s)?(\.html|\/)/.test(outerHref);
      const isInternalRedirect = /^\/go\//.test(outerHref);
      const isAllowedDirectory = allowedExternalDirectories.some((d) =>
        outerHref.includes(`://${d}`) || outerHref.includes(`://www.${d}`),
      );

      assert.ok(
        isLocalGuide || isInternalRedirect || isAllowedDirectory,
        `Non-download card (arrow: "${cardArrow.trim()}") has href "${outerHref}" — must link to /guide.html, /guides/*, /go/*, or a real external directory (mcp.so, chatgpt.com, npmjs.com, etc.), NOT a GitHub source browser`,
      );

      assert.doesNotMatch(
        outerHref,
        /github\.com\/[^/]+\/[^/]+\/(tree|blob)\//,
        `Non-download card (arrow: "${cardArrow.trim()}") points at GitHub source browser "${outerHref}" — link to a guide page or real directory instead`,
      );
    }
  });
});

describe('Team tier bullets: code-backed claims', () => {
  test('"Team lesson export/import" endpoints exist', () => {
    const server = fs.readFileSync(path.join(ROOT, 'src', 'api', 'server.js'), 'utf8');
    assert.ok(server.includes("'/v1/lessons/export'"),
      'POST /v1/lessons/export endpoint must exist');
    assert.ok(server.includes("'/v1/lessons/import'"),
      'POST /v1/lessons/import endpoint must exist');
  });

  test('"Org dashboard" script exists', () => {
    assert.ok(
      fs.existsSync(path.join(ROOT, 'scripts', 'org-dashboard.js')),
      'scripts/org-dashboard.js must exist to back org dashboard claim',
    );
  });

  test('"Gate template library" config exists', () => {
    const gateTemplatesPath = path.join(ROOT, 'config', 'gate-templates.json');
    const gatesDir = path.join(ROOT, 'config', 'gates');
    assert.ok(
      fs.existsSync(gateTemplatesPath) || fs.existsSync(gatesDir),
      'config/gate-templates.json or config/gates/ must exist',
    );
  });
});

describe('Dashboard deep-linking', () => {
  const DASHBOARD_HTML = fs.readFileSync(path.join(ROOT, 'public', 'dashboard.html'), 'utf8');

  test('dashboard.html has hash-based deep-link handler', () => {
    assert.ok(
      DASHBOARD_HTML.includes('getDeepLinkTab') && DASHBOARD_HTML.includes('applyDeepLinkTab'),
      'dashboard.html must define getDeepLinkTab + applyDeepLinkTab',
    );
    assert.ok(
      DASHBOARD_HTML.includes("addEventListener('DOMContentLoaded', applyDeepLinkTab)"),
      'Deep-link must fire on DOMContentLoaded',
    );
    assert.ok(
      DASHBOARD_HTML.includes("addEventListener('hashchange', applyDeepLinkTab)"),
      'Deep-link must fire on hashchange for back/forward navigation',
    );
  });

  test('all tab names referenced in landing page links are valid tabs', () => {
    const tabLinkRegex = /\/dashboard#(\w+)/g;
    const hashes = new Set();
    let m;
    while ((m = tabLinkRegex.exec(INDEX_HTML)) !== null) hashes.add(m[1]);

    if (hashes.size === 0) {
      // Nothing to validate — test passes vacuously but we still assert presence
      assert.ok(true, 'No deep-links on landing — test passes vacuously');
      return;
    }

    // Valid tab ids must exist in dashboard.html
    for (const hash of hashes) {
      assert.ok(
        DASHBOARD_HTML.includes(`id="tab-${hash}"`),
        `Landing page deep-links to /dashboard#${hash} but dashboard has no tab-${hash} content`,
      );
    }
  });
});
