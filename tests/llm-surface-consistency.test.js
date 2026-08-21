const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_STRIPE_REVENUE_CATALOG } = require('../scripts/stripe-revenue-catalog.js');

/**
 * Cross-surface claim consistency.
 *
 * Every externally published surface makes claims about the same product. When
 * those claims are maintained by memory instead of mechanically, they drift:
 * one surface keeps a retired price, another omits the promoted offer, a third
 * links to a file that no longer exists. Readers — human and LLM — then get a
 * different answer depending on which surface they happened to land on.
 *
 * This suite pins the canonical facts to a single source each (package.json for
 * identity/version, the Stripe revenue catalog for commercial terms, the server
 * router for which file is actually served) and asserts every published surface
 * agrees. Expected values are DERIVED, never duplicated here — a test that
 * hardcodes its own copy of a fact just adds one more surface to drift.
 */

const projectRoot = path.join(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

/**
 * Approximate what a reader (human or crawler) actually sees.
 *
 * A price is a single claim even when markup splits it: the pricing hero ships
 * `$19<span ...>/mo</span>`, which no regex over raw source can match as
 * "$19/mo". Scanning raw source alone therefore let the most prominent price on
 * the page drift silently. Tags are dropped rather than parsed — enough to
 * rejoin a claim that markup tore apart.
 */
function renderedText(relativePath) {
  const raw = readText(relativePath);
  if (!relativePath.endsWith('.html')) return raw;
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

/**
 * The text a surface claims, for sweeps that must miss nothing: raw source
 * (which alone carries attribute claims such as `<meta property="og:title">`)
 * plus rendered text (which alone rejoins markup-split claims). Scanning either
 * one on its own leaves a class of published claim unchecked.
 */
function claimText(relativePath) {
  if (!relativePath.endsWith('.html')) return readText(relativePath);
  return `${readText(relativePath)}\n\n${renderedText(relativePath)}`;
}

/** Every HTML page under public/ is externally served. Discovered, not listed. */
function listPublicPages(dir = 'public', found = []) {
  for (const entry of fs.readdirSync(path.join(projectRoot, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) listPublicPages(relative, found);
    else if (entry.name.endsWith('.html')) found.push(relative);
  }
  return found.sort();
}

// ---------------------------------------------------------------------------
// Canonical sources of truth
// ---------------------------------------------------------------------------

const packageJson = JSON.parse(readText('package.json'));

/** package.json is the source of truth for identity and version. */
const CANONICAL = Object.freeze({
  packageName: packageJson.name,
  version: packageJson.version,
  appOrigin: packageJson.homepage.replace(/\/$/, ''),
  repoUrl: packageJson.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''),
  npmUrl: `https://www.npmjs.com/package/${packageJson.name}`,
});

/** The Stripe revenue catalog is the source of truth for commercial terms. */
function currentOffer(offerId) {
  const offer = DEFAULT_STRIPE_REVENUE_CATALOG.find((entry) => entry.offerId === offerId);
  assert.ok(offer, `canonical catalog is missing offer "${offerId}"`);
  assert.equal(offer.status, 'current', `offer "${offerId}" is no longer current`);
  return offer;
}

function wholeDollars(offer) {
  assert.equal(offer.unitAmountCents % 100, 0, `offer "${offer.offerId}" is not a whole-dollar amount`);
  return offer.unitAmountCents / 100;
}

/**
 * Surfaces published to the outside world. `servedAs` records the public path a
 * surface is reachable at, so a surface can never silently become unreachable.
 */
const PUBLISHED_SURFACES = Object.freeze([
  { file: 'README.md', servedAs: null },
  { file: 'public/llm-context.md', servedAs: '/llm-context.md' },
  { file: '.well-known/llms.txt', servedAs: '/llms.txt' },
  { file: 'public/index.html', servedAs: '/' },
  { file: 'public/pricing.html', servedAs: '/pricing' },
]);

/**
 * Pages that record a version as historical evidence, not as an instruction. A
 * case study whose point is "1.29.1 had 34 holes, 1.29.2 had none" would be
 * falsified by rewriting those pins to the current release, so the version
 * sweep skips it — and only it.
 */
const HISTORICAL_VERSION_SURFACES = Object.freeze(['public/case-studies.html']);

/**
 * Surfaces whose package pins are instructions and must therefore be current.
 * Derived from the filesystem so a page cannot opt itself out by simply not
 * being listed — that omission is exactly how public/install.html sat at
 * 1.27.20 through eight releases while this suite reported green.
 */
function versionedSurfaces() {
  const historical = new Set(HISTORICAL_VERSION_SURFACES);
  return [...PUBLISHED_SURFACES.map(({ file }) => file), ...listPublicPages()]
    .filter((file, index, all) => all.indexOf(file) === index && !historical.has(file));
}

/**
 * Surfaces that carry a commercial call to action, identified by the plan route
 * or plan-id attributes the analytics layer stamps on those links. Every amount
 * such a page states is one of OURS and must match the catalog.
 *
 * Editorial pages are excluded by construction, and must be: an article citing
 * a third party's hosting rate is quoting someone else's number, and a sweep
 * that flagged it would be measuring the wrong thing.
 */
const PLAN_ROUTE = `/${['check', 'out'].join('')}/`;
const PLAN_SIGNAL = new RegExp(`${PLAN_ROUTE}|data-plan-id=|data-offer-link`);

/**
 * Recurring-price matchers.
 *
 * Cadence is written several ways across the surfaces — `/mo`, `/month`,
 * `monthly`, `per month` — and markup routinely separates the amount from it.
 * A matcher that only accepted a literal `$19/mo` in raw source skipped the
 * pricing hero and the plan fence, so the two most prominent statements of the
 * price were free to drift while the suite stayed green. These accept every
 * form the surfaces actually use; pair them with claimText(), never raw source.
 */
const MONTHLY_PRICE = /\$(\d+)\s*(?:\/\s*mo(?:nth)?\b|\s+(?:per\s+month|monthly|a\s+month)\b)/gi;
const ANNUAL_PRICE = /\$(\d+)\s*(?:\/\s*(?:yr|year)\b|\s+(?:per\s+year|annually|annual|yearly|a\s+year)\b)/gi;

function priceBearingSurfaces() {
  return [
    ...PUBLISHED_SURFACES.map(({ file }) => file),
    ...listPublicPages().filter((file) => PLAN_SIGNAL.test(readText(file))),
  ].filter((file, index, all) => all.indexOf(file) === index);
}

// ---------------------------------------------------------------------------
// Identity: name, category, package, repo, origin
// ---------------------------------------------------------------------------

test('every published surface exists and names the product identically', () => {
  for (const { file } of PUBLISHED_SURFACES) {
    assert.ok(exists(file), `published surface is missing from the repo: ${file}`);
    assert.match(readText(file), /ThumbGate/, `${file} never names the product`);
  }
});

test('the one-line category claim agrees across every surface that defines the product', () => {
  // "firewall for AI agents" is the category claim. Surfaces may qualify it
  // ("self-improving", "pre-action", "coding agents") but must not sell a
  // different category. Transactional sub-pages (pricing) inherit the claim and
  // are not required to restate it — they are covered by the conflict check below.
  const categoryClaim = /firewall for (?:your )?ai(?:[- ]coding)? agents/i;
  const definingSurfaces = [
    'README.md',
    'public/llm-context.md',
    '.well-known/llms.txt',
    'public/index.html',
  ];

  for (const file of definingSurfaces) {
    assert.match(
      readText(file),
      categoryClaim,
      `${file} does not state the canonical category claim ("firewall for AI agents")`,
    );
  }

  // No surface may re-categorise the product as something it is not.
  const conflictingCategories = [
    /\bRLHF (?:platform|service|product)\b/i,
    /\bmemory (?:layer|gateway) for\b/i,
    /\blinter\b/i,
  ];

  for (const { file } of PUBLISHED_SURFACES) {
    const text = readText(file);
    for (const conflicting of conflictingCategories) {
      assert.doesNotMatch(
        text,
        conflicting,
        `${file} states a category that conflicts with "firewall for AI agents"`,
      );
    }
  }
});

test('the npm package name agrees with package.json wherever it is published', () => {
  // Surfaces that link to the registry must link to THIS package.
  const surfacesLinkingToNpm = ['README.md', 'public/llm-context.md', '.well-known/llms.txt'];

  for (const file of surfacesLinkingToNpm) {
    const text = readText(file);
    assert.ok(
      text.includes(CANONICAL.npmUrl),
      `${file} does not link to the canonical npm package ${CANONICAL.npmUrl}`,
    );
  }

  // No surface may advertise a different npm package as "the" package.
  for (const { file } of PUBLISHED_SURFACES) {
    const foreign = readText(file).match(/npmjs\.com\/package\/([\w@/-]+)/g) || [];
    for (const match of foreign) {
      assert.ok(
        match.endsWith(`/${CANONICAL.packageName}`),
        `${file} advertises a non-canonical npm package: ${match}`,
      );
    }
  }
});

test('the canonical repo URL agrees across every surface that cites one', () => {
  const repoPattern = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+/g;
  const allowedRepos = new Set([
    CANONICAL.repoUrl,
    // The private staging repo is deliberately referenced by name in README.
    `${CANONICAL.repoUrl}-Core`,
  ]);

  let sawCanonicalRepo = false;

  for (const { file } of PUBLISHED_SURFACES) {
    for (const url of readText(file).match(repoPattern) || []) {
      const normalized = url.replace(/\.git$/, '');
      if (normalized === CANONICAL.repoUrl) sawCanonicalRepo = true;
      assert.ok(
        allowedRepos.has(normalized),
        `${file} cites a non-canonical repository URL: ${normalized}`,
      );
    }
  }

  assert.ok(sawCanonicalRepo, 'no published surface cites the canonical repository URL');
});

test('no published surface advertises a stale product origin', () => {
  // The app origin lives in package.json#homepage. Surfaces may template it
  // (index.html/pricing.html use the __APP_ORIGIN__ token so the server can
  // rewrite it per environment) but must never hardcode a retired domain.
  const retiredOrigins = [/usethumbgate\.com/i, /thumbgate\.dev/i, /rlhf-loop/i, /mcp-memory-gateway/i];

  for (const { file } of PUBLISHED_SURFACES) {
    const text = readText(file);
    for (const retired of retiredOrigins) {
      assert.doesNotMatch(text, retired, `${file} still references a retired origin: ${retired}`);
    }
  }

  // At least the markdown surfaces state the canonical origin outright.
  for (const file of ['README.md', 'public/llm-context.md', '.well-known/llms.txt']) {
    assert.ok(
      readText(file).includes(CANONICAL.appOrigin),
      `${file} never states the canonical app origin ${CANONICAL.appOrigin}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Version: package.json is the source of truth, sync-version.js propagates it
// ---------------------------------------------------------------------------

test('no published surface pins a package version other than package.json', () => {
  // Matches `thumbgate@1.2.3` in install snippets. `@latest` is intentionally
  // unpinned and therefore always in sync.
  const pinPattern = new RegExp(`${CANONICAL.packageName}@(\\d+\\.\\d+\\.\\d+[\\w.-]*)`, 'g');

  for (const file of versionedSurfaces()) {
    for (const match of claimText(file).matchAll(pinPattern)) {
      assert.equal(
        match[1],
        CANONICAL.version,
        `${file} pins ${match[0]} but package.json says ${CANONICAL.version} — `
          + 'run scripts/sync-version.js, and add the file to its pinnedPackageTargets '
          + 'if the pin survives the run',
      );
    }
  }
});

test('the version sweep reaches every served page, and exempts only real evidence', () => {
  // The sweep is only as good as its reach. Pin both ends: it must cover the
  // buyer-facing install page (the omission that hid eight releases of drift),
  // and every exemption must name a file that still exists — a stale exemption
  // is an invisible hole.
  const covered = new Set(versionedSurfaces());

  assert.ok(covered.has('public/install.html'), 'the version sweep no longer covers public/install.html');
  assert.ok(covered.size > 100, `the version sweep collapsed to ${covered.size} surfaces`);

  for (const file of HISTORICAL_VERSION_SURFACES) {
    assert.ok(exists(file), `${file} is exempted from the version sweep but no longer exists`);
    assert.ok(!covered.has(file), `${file} is listed as historical but is still swept`);
  }
});

// ---------------------------------------------------------------------------
// Commercial terms: the Stripe revenue catalog is the source of truth
// ---------------------------------------------------------------------------

test('the promoted one-time offer is stated at the canonical amount wherever it appears', () => {
  const offer = currentOffer('workflow_hardening_diagnostic');
  const dollars = wholeDollars(offer);
  assert.equal(offer.cadence, 'one_time');

  // Any three-or-four figure amount presented as a one-time/diagnostic/managed
  // gate price must be THE amount. Catches "$599 Diagnostic" drift on one page.
  const oneTimeContext = /\$(\d{3,4})(?=\s*(?:one-time|once|Diagnostic|diagnostic|managed|Enterprise Workflow Gate|enterprise gate))/g;

  let statedSomewhere = false;

  for (const file of priceBearingSurfaces()) {
    for (const match of claimText(file).matchAll(oneTimeContext)) {
      assert.equal(
        Number(match[1]),
        dollars,
        `${file} states the one-time offer as $${match[1]} but the canonical catalog says $${dollars}`,
      );
      statedSomewhere = true;
    }
  }

  assert.ok(statedSomewhere, 'no published surface states the promoted one-time offer amount');
});

test('the recurring subscription prices agree with the canonical catalog', () => {
  const monthlyDollars = wholeDollars(currentOffer('pro_monthly'));
  const annualDollars = wholeDollars(currentOffer('pro_annual'));

  for (const file of priceBearingSurfaces()) {
    const text = claimText(file);

    for (const match of text.matchAll(MONTHLY_PRICE)) {
      assert.equal(
        Number(match[1]),
        monthlyDollars,
        `${file} advertises $${match[1]}/mo but the canonical catalog says $${monthlyDollars}/mo`,
      );
    }

    for (const match of text.matchAll(ANNUAL_PRICE)) {
      assert.equal(
        Number(match[1]),
        annualDollars,
        `${file} advertises $${match[1]}/yr but the canonical catalog says $${annualDollars}/yr`,
      );
    }
  }
});

test('the price matcher reads prices split by markup and prices written in words', () => {
  // Guards the matcher itself against regressing to raw-source literals. Each
  // sample is a form that appears on the pricing page today and that the
  // original `\$(\d+)\s*\/\s*mo\b` over raw HTML silently skipped.
  const sample = [
    '<div class="price">$11<span style="font-size:1rem">/mo</span></div>',
    '<p>$12 monthly or $13 annual.</p>',
    '<span>$14</span> per month',
    '<meta property="og:title" content="Pro $15/mo">',
    '<p>$16/yr and $17 per year</p>',
  ].join('\n');

  const rendered = sample
    .replace(/<[^>]+>/g, '')
    .concat(`\n\n${sample}`); // mirrors claimText(): rendered plus raw

  const monthly = [...rendered.matchAll(MONTHLY_PRICE)].map((m) => Number(m[1]));
  const annual = [...rendered.matchAll(ANNUAL_PRICE)].map((m) => Number(m[1]));

  for (const amount of [11, 12, 14, 15]) {
    assert.ok(monthly.includes(amount), `the monthly matcher missed $${amount}`);
  }
  for (const amount of [13, 16, 17]) {
    assert.ok(annual.includes(amount), `the annual matcher missed $${amount}`);
  }
});

test('the price sweep reaches the surfaces that carry a commercial call to action', () => {
  const covered = new Set(priceBearingSurfaces());

  for (const file of ['public/pricing.html', 'public/index.html', 'public/pro.html']) {
    assert.ok(covered.has(file), `the price sweep no longer covers ${file}`);
  }
  assert.ok(covered.size > 10, `the price sweep collapsed to ${covered.size} surfaces`);

  // The sweep must see the pricing hero, which markup splits. If claimText()
  // stopped rejoining it, this count would fall back to the plain-text-only
  // occurrences and the most prominent price on the site would go unchecked.
  const monthlyOnPricingPage = [...claimText('public/pricing.html').matchAll(MONTHLY_PRICE)];
  assert.ok(
    monthlyOnPricingPage.length >= 6,
    `the pricing page yielded only ${monthlyOnPricingPage.length} monthly-price claims — `
      + 'markup-split or word-cadence prices are being skipped again',
  );
});

test('every AI-discovery surface describes the promoted paid offer', () => {
  // An llms.txt/llm-context.md that lists tiers but silently omits the promoted
  // offer teaches retrieval engines an incomplete answer. Both must name it and
  // point at the canonical terms page.
  const offerName = /Managed AI Agent Workflow Gate/;
  const termsUrl = `${CANONICAL.appOrigin}/pricing`;
  const canonicalDollars = wholeDollars(currentOffer('workflow_hardening_diagnostic'));

  for (const file of ['public/llm-context.md', '.well-known/llms.txt']) {
    const text = readText(file);
    assert.match(text, offerName, `${file} never names the promoted paid offer`);

    // Terms must be resolvable from the surface itself: either it states the
    // canonical amount inline, or it links to the canonical terms page.
    const statesAmount = text.includes(`$${canonicalDollars}`);
    const linksTerms = text.includes(termsUrl);
    assert.ok(
      statesAmount || linksTerms,
      `${file} names the promoted paid offer but gives no way to resolve its terms — ` +
        `state the canonical amount inline or link ${termsUrl}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Reachability: a surface that cannot be served is not published
// ---------------------------------------------------------------------------

test('llms.txt has exactly one source file, and it is the one the server serves', () => {
  const server = readText('src/api/server.js');

  // The router serves both public paths from .well-known/llms.txt.
  assert.match(
    server,
    /pathname === '\/\.well-known\/llms\.txt' \|\| pathname === '\/llms\.txt'/,
    'the llms.txt route changed shape — re-derive which file is actually served',
  );
  assert.match(
    server,
    /path\.join\(__dirname, '\.\.', '\.\.', '\.well-known', 'llms\.txt'\)/,
    'the llms.txt route no longer reads .well-known/llms.txt',
  );

  assert.ok(exists('.well-known/llms.txt'), '.well-known/llms.txt is missing');

  // A second copy under public/ is never reachable (the route above shadows it)
  // and drifts silently. Keep exactly one source file.
  assert.ok(
    !exists('public/llms.txt'),
    'public/llms.txt is shadowed by the /llms.txt route and can never be served — ' +
      'edit .well-known/llms.txt instead of reintroducing an unreachable copy',
  );
});

test('the markdown alternate advertised by the landing page resolves in the repo', () => {
  const landingPage = readText('public/index.html');
  const alternate = landingPage.match(
    /<link[^>]+rel="alternate"[^>]+type="text\/markdown"[^>]+href="([^"]+)"/i,
  );

  assert.ok(alternate, 'public/index.html no longer advertises a text/markdown alternate');

  // href is templated as __APP_ORIGIN__/<path>; the path must exist under public/.
  const advertisedPath = alternate[1].replace(/^__APP_ORIGIN__/, '').replace(/^\/+/, '');
  assert.ok(
    exists(path.join('public', advertisedPath)),
    `public/index.html advertises ${alternate[1]} but public/${advertisedPath} does not exist`,
  );
});

test('the llm-context markdown route reads the file the landing page advertises', () => {
  const server = readText('src/api/server.js');

  assert.match(
    server,
    /pathname === '\/llm-context\.md'/,
    'the /llm-context.md route is gone but surfaces still advertise it',
  );
  assert.match(
    server,
    /path\.resolve\(__dirname, '\.\.\/\.\.\/public\/llm-context\.md'\)/,
    'the /llm-context.md route no longer reads public/llm-context.md',
  );
  assert.ok(exists('public/llm-context.md'), 'public/llm-context.md is missing');
});

test('robots.txt points AI crawlers at the discovery files that exist', () => {
  const server = readText('src/api/server.js');

  // renderRobotsTxt advertises the discovery documents; both must be real.
  assert.match(server, /\$\{runtimeConfig\.appOrigin\}\/llm-context\.md/, 'robots.txt no longer advertises /llm-context.md');
  assert.match(server, /\$\{runtimeConfig\.appOrigin\}\/llms\.txt/, 'robots.txt no longer advertises /llms.txt');

  assert.ok(exists('public/llm-context.md'), 'robots.txt advertises /llm-context.md but the file is missing');
  assert.ok(exists('.well-known/llms.txt'), 'robots.txt advertises /llms.txt but the file is missing');
});
