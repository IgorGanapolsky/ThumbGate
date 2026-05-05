'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SKOOL_ORIGIN = 'https://www.skool.com';
const DEFAULT_LIMIT = 20;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const KEYWORD_GROUPS = [
  {
    key: 'claude-code',
    score: 10,
    patterns: [/\bclaude code\b/i, /\bclaude\b/i, /\bcodex\b/i, /\bcursor\b/i],
    reason: 'agentic coding workflow',
  },
  {
    key: 'mcp',
    score: 8,
    patterns: [/\bmcp\b/i, /model context protocol/i],
    reason: 'MCP adoption surface',
  },
  {
    key: 'automation-build',
    score: 7,
    patterns: [/\bn8n\b/i, /\bworkflow\b/i, /\bautomation\b/i, /\bagent\b/i, /\bai solution\b/i],
    reason: 'automation builder audience',
  },
  {
    key: 'breakage-support',
    score: 12,
    patterns: [/\bhelp\b/i, /\bstuck\b/i, /\blost\b/i, /\berror\b/i, /\bfail/i, /\bbreak/i, /\bnot working\b/i],
    reason: 'active pain and troubleshooting intent',
  },
  {
    key: 'cost-control',
    score: 8,
    patterns: [/\bcredit/i, /\bcost\b/i, /\bexpensive\b/i, /\btoken/i, /\bbudget\b/i],
    reason: 'cost and token governance pain',
  },
  {
    key: 'deployment-stack',
    score: 7,
    patterns: [/\bgithub\b/i, /\bsupabase\b/i, /\bvercel\b/i, /\brailway\b/i, /\bdeploy/i],
    reason: 'production-change risk',
  },
  {
    key: 'buyer-intent',
    score: 9,
    patterns: [/\bhire\b/i, /\bclient\b/i, /\bpaid\b/i, /\bagency\b/i, /\bconsultant\b/i, /\baffiliate\b/i],
    reason: 'commercial intent',
  },
];

function asPositiveInt(value, defaultValue, maxValue = 100) {
  if (value == null || value === '') return defaultValue;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Expected a positive number, got: ${value}`);
  }
  return Math.min(Math.floor(number), maxValue);
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function redactSensitive(value) {
  return normalizeText(value).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
}

function truncateText(value, maxLength = 320) {
  const text = normalizeText(value);
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return `${chars.slice(0, Math.max(0, maxLength - 3)).join('').trim()}...`;
}

function normalizeCategoryName(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMaybeJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function normalizeCommunitySlug(value) {
  const raw = normalizeText(value)
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  const [slug] = raw.split(/[/?#]/);
  if (!slug) {
    throw new Error('Missing Skool community slug.');
  }
  return slug;
}

function isLikelySkoolCategoryId(value) {
  return /^[a-f0-9]{16,}$/i.test(String(value || ''));
}

function buildSkoolUrl(options = {}) {
  const page = asPositiveInt(options.page, 1, 500);
  const baseUrl = options.url
    ? new URL(options.url)
    : new URL(`/${normalizeCommunitySlug(options.community)}`, SKOOL_ORIGIN);

  if (!baseUrl.hostname.endsWith('skool.com')) {
    throw new Error(`Expected a skool.com URL, got: ${baseUrl.hostname}`);
  }

  if (options.categoryId) {
    baseUrl.searchParams.set('c', options.categoryId);
  }
  if (options.sortType) {
    baseUrl.searchParams.set('sort', String(options.sortType));
  }
  if (page > 1) {
    baseUrl.searchParams.set('p', String(page));
  }

  return baseUrl.toString();
}

function loadCookieHeader(options = {}) {
  if (options.cookie) return String(options.cookie).trim();
  if (process.env.SKOOL_COOKIE) return process.env.SKOOL_COOKIE.trim();

  const cookieFile = options.cookieFile || process.env.SKOOL_COOKIE_FILE;
  if (!cookieFile) return '';

  const resolved = path.resolve(cookieFile);
  return fs.readFileSync(resolved, 'utf8').trim();
}

function extractNextData(html) {
  const match = String(html || '').match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) {
    throw new Error('Skool page did not include __NEXT_DATA__. The page may require auth or changed shape.');
  }
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`Could not parse Skool __NEXT_DATA__: ${error.message}`);
  }
}

function resolvePageProps(nextData) {
  return nextData && nextData.props && nextData.props.pageProps
    ? nextData.props.pageProps
    : {};
}

function normalizeLabel(label) {
  const metadata = label.metadata || {};
  return {
    id: label.id,
    name: redactSensitive(label.displayName || metadata.displayName || label.name || ''),
    description: redactSensitive(metadata.description || label.description || ''),
    postCount: Number(label.posts || metadata.posts || 0),
  };
}

function buildLabelsById(currentGroup = {}) {
  const labels = Array.isArray(currentGroup.labels) ? currentGroup.labels : [];
  return labels.reduce((acc, label) => {
    if (label && label.id) {
      acc[label.id] = normalizeLabel(label);
    }
    return acc;
  }, {});
}

function normalizeCommunity(currentGroup = {}, sourceUrl) {
  const metadata = currentGroup.metadata || {};
  const url = new URL(sourceUrl || SKOOL_ORIGIN);
  const slug = currentGroup.name || url.pathname.split('/').filter(Boolean)[0] || '';
  return {
    id: currentGroup.id || '',
    slug,
    url: `${url.origin}/${slug}`,
    name: redactSensitive(metadata.displayName || currentGroup.displayName || slug),
    description: redactSensitive(metadata.description || ''),
    totalMembers: Number(metadata.totalMembers || currentGroup.totalMembers || 0),
    totalOnlineMembers: Number(metadata.totalOnlineMembers || 0),
    totalAdmins: Number(metadata.totalAdmins || 0),
    totalPosts: Number(metadata.totalPosts || 0),
    links: Array.isArray(metadata.links)
      ? metadata.links.map((link) => ({
        label: redactSensitive(link.label || link.title || ''),
        url: redactSensitive(link.url || link.href || ''),
      }))
      : [],
  };
}

function normalizeUser(user = {}) {
  const metadata = user.metadata || {};
  const name = metadata.displayName || user.name || [user.firstName, user.lastName].filter(Boolean).join(' ');
  return {
    id: user.id || '',
    name: redactSensitive(name),
    handle: redactSensitive(user.username || metadata.username || ''),
  };
}

function buildPostUrl(post, sourceUrl, communitySlug) {
  if (!post || !post.name) return sourceUrl || '';
  const url = new URL(sourceUrl || `${SKOOL_ORIGIN}/${communitySlug || ''}`);
  const slug = communitySlug || url.pathname.split('/').filter(Boolean)[0] || '';
  return `${url.origin}/${slug}/${post.name}`;
}

function normalizePostTree(postTree, labelsById, sourceUrl, communitySlug) {
  const post = postTree && postTree.post ? postTree.post : postTree;
  if (!post) return null;

  const metadata = post.metadata || {};
  const category = labelsById[post.labelId] || null;
  const contributors = parseMaybeJson(metadata.contributors, []);
  const content = redactSensitive(metadata.content || post.content || '');
  const title = redactSensitive(metadata.title || post.title || post.name || '');
  const children = Array.isArray(postTree.children) ? postTree.children : [];

  return {
    id: post.id || '',
    slug: post.name || '',
    url: buildPostUrl(post, sourceUrl, communitySlug),
    title,
    content,
    excerpt: truncateText(content, 320),
    author: normalizeUser(post.user || {}),
    category: category ? category.name : '',
    categoryId: post.labelId || '',
    pinned: Boolean(metadata.pinned),
    upvotes: Number(metadata.upvotes || post.upvotes || 0),
    comments: Number(metadata.comments || post.comments || children.length || 0),
    contributors: Array.isArray(contributors)
      ? contributors.map((contributor) => normalizeUser(contributor))
      : [],
    createdAt: post.createdAt || '',
    updatedAt: post.updatedAt || '',
    lastCommentAt: metadata.lastComment && metadata.lastComment.createdAt
      ? metadata.lastComment.createdAt
      : '',
    childCount: children.length,
  };
}

function collectPostTrees(pageProps) {
  const trees = [];
  if (Array.isArray(pageProps.postTrees)) {
    trees.push(...pageProps.postTrees);
  }
  if (pageProps.postTree) {
    trees.push(pageProps.postTree);
  }
  return trees;
}

function dedupePosts(posts) {
  const seen = new Set();
  const result = [];
  for (const post of posts) {
    const key = post.id || post.slug || post.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(post);
  }
  return result;
}

function parseSkoolHtml(html, options = {}) {
  const nextData = extractNextData(html);
  const pageProps = resolvePageProps(nextData);
  const sourceUrl = options.sourceUrl || SKOOL_ORIGIN;
  const currentGroup = pageProps.currentGroup || {};
  const labelsById = buildLabelsById(currentGroup);
  const community = normalizeCommunity(currentGroup, sourceUrl);
  const labels = Object.values(labelsById);
  const posts = dedupePosts(
    collectPostTrees(pageProps)
      .map((tree) => normalizePostTree(tree, labelsById, sourceUrl, community.slug))
      .filter(Boolean),
  );

  return {
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    page: Number(pageProps.page || 1),
    sortType: pageProps.sortType || '',
    total: Number(pageProps.total || posts.length),
    selectedCategoryId: pageProps.category || '',
    community,
    labels,
    posts,
    upcomingEvents: Array.isArray(pageProps.upcomingEvents)
      ? pageProps.upcomingEvents.map((event) => ({
        id: event.id || '',
        title: redactSensitive(event.title || (event.metadata && event.metadata.title) || ''),
        startsAt: event.startsAt || (event.metadata && event.metadata.startsAt) || '',
      }))
      : [],
  };
}

function resolveCategoryId(parsed, category) {
  if (!category) return '';
  if (isLikelySkoolCategoryId(category)) return category;

  const needle = normalizeCategoryName(category);
  const exact = parsed.labels.find((label) => normalizeCategoryName(label.name) === needle);
  if (exact) return exact.id;

  const partial = parsed.labels.find((label) => normalizeCategoryName(label.name).includes(needle));
  if (partial) return partial.id;

  const names = parsed.labels.map((label) => label.name).filter(Boolean).join(', ');
  throw new Error(`Could not find Skool category "${category}". Available categories: ${names}`);
}

async function fetchSkoolHtml(url, options = {}, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('This Node runtime does not provide fetch(). Use Node 18+.');
  }

  const cookie = loadCookieHeader(options);
  const controller = new AbortController();
  const timeoutMs = asPositiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS, 120000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'user-agent': options.userAgent || DEFAULT_USER_AGENT,
  };
  if (cookie) headers.cookie = cookie;

  try {
    const response = await fetchImpl(url, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response || !response.ok) {
      const status = response ? response.status : 'unknown';
      throw new Error(`Skool request failed with status ${status}`);
    }
    return {
      url: response.url || url,
      html: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function limitParsedPosts(parsed, limit) {
  const next = { ...parsed };
  next.posts = parsed.posts.slice(0, asPositiveInt(limit, DEFAULT_LIMIT, 200));
  return next;
}

async function readSkoolCommunity(options = {}, deps = {}) {
  if (!options.url && !options.community) {
    throw new Error('Provide --url or --community.');
  }

  const category = options.category || options.categoryId || '';
  const categoryIsId = category && isLikelySkoolCategoryId(category);
  const firstUrl = buildSkoolUrl({
    ...options,
    categoryId: categoryIsId ? category : options.categoryId,
  });
  const first = await fetchSkoolHtml(firstUrl, options, deps);
  let parsed = parseSkoolHtml(first.html, { sourceUrl: first.url });

  if (category && !categoryIsId) {
    const categoryId = resolveCategoryId(parsed, category);
    const categoryUrl = buildSkoolUrl({
      ...options,
      url: options.url || parsed.community.url,
      categoryId,
    });
    const categoryResponse = await fetchSkoolHtml(categoryUrl, options, deps);
    parsed = parseSkoolHtml(categoryResponse.html, { sourceUrl: categoryResponse.url });
    parsed.selectedCategoryId = categoryId;
  }

  return limitParsedPosts(parsed, options.limit);
}

function scorePost(post, options = {}) {
  const haystack = `${post.title} ${post.content} ${post.category}`.toLowerCase();
  const matchedKeywords = [];
  let score = 0;
  const reasons = [];

  for (const group of KEYWORD_GROUPS) {
    if (group.patterns.some((pattern) => pattern.test(haystack))) {
      matchedKeywords.push(group.key);
      score += group.score;
      reasons.push(group.reason);
    }
  }

  const category = normalizeCategoryName(post.category);
  if (category.includes('support')) score += 12;
  if (category.includes('hire') || category.includes('looking for hire')) score += 9;
  if (category.includes('wins')) score += 3;
  if (post.pinned) score += 4;
  score += Math.min(10, Math.floor(Number(post.comments || 0) / 10));
  score += Math.min(8, Math.floor(Number(post.upvotes || 0) / 25));

  const focus = normalizeText(options.focus).toLowerCase();
  if (focus && haystack.includes(focus)) {
    matchedKeywords.push('focus-match');
    score += 12;
    reasons.push(`matches focus "${focus}"`);
  }

  return {
    score,
    matchedKeywords: [...new Set(matchedKeywords)],
    reasons: [...new Set(reasons)],
  };
}

function buildSuggestedAction(post, matchedKeywords) {
  if (matchedKeywords.includes('breakage-support') || matchedKeywords.includes('deployment-stack')) {
    return 'Draft a helpful reply that diagnoses the workflow risk, then mention ThumbGate as a pre-action gate for Claude Code/Codex before production files, GitHub, Supabase, Vercel, or Railway are touched.';
  }
  if (matchedKeywords.includes('cost-control')) {
    return 'Draft a reply about token and credit waste from repeated agent mistakes, then offer ThumbGate as a budget-aware Reliability Gateway for agent sessions.';
  }
  if (matchedKeywords.includes('buyer-intent')) {
    return 'Add this person to the outreach queue with a concise ThumbGate workflow-hardening angle for AI consultants and automation builders.';
  }
  return 'Save this as a lead-discovery signal and draft a non-spam educational reply tied to pre-action gates and repeatable agent reliability.';
}

function isAdministrativePost(post) {
  const title = normalizeText(post.title).toLowerCase();
  return /please read|rules and guidelines|community rules|read this first|start here|welcome/.test(title);
}

function rankSkoolRevenueSignals(posts, options = {}) {
  const limit = asPositiveInt(options.limit, 10, 100);
  return posts
    .filter((post) => options.includeAdministrative || !isAdministrativePost(post))
    .map((post) => {
      const score = scorePost(post, options);
      return {
        id: post.id,
        score: score.score,
        title: post.title,
        url: post.url,
        category: post.category,
        author: post.author,
        upvotes: post.upvotes,
        comments: post.comments,
        matchedKeywords: score.matchedKeywords,
        whyThumbGate: score.reasons.length
          ? `ThumbGate fit: ${score.reasons.join(', ')}.`
          : 'ThumbGate fit: community member is discussing AI automation reliability.',
        suggestedAction: buildSuggestedAction(post, score.matchedKeywords),
        excerpt: post.excerpt,
      };
    })
    .filter((signal) => signal.score > 0)
    .sort((a, b) => b.score - a.score || b.comments - a.comments || b.upvotes - a.upvotes)
    .slice(0, limit);
}

function buildSkoolDigest(parsed, options = {}) {
  return {
    community: parsed.community,
    sourceUrl: parsed.sourceUrl,
    fetchedAt: parsed.fetchedAt,
    total: parsed.total,
    page: parsed.page,
    sortType: parsed.sortType,
    labels: parsed.labels,
    signals: rankSkoolRevenueSignals(parsed.posts, {
      limit: options.signalLimit || options.limit || 10,
      focus: options.focus,
    }),
    posts: parsed.posts,
  };
}

function formatMarkdownDigest(digest) {
  const lines = [
    `# Skool Digest: ${digest.community.name}`,
    '',
    `Source: ${digest.sourceUrl}`,
    `Members: ${digest.community.totalMembers}`,
    `Visible posts on page: ${digest.posts.length}`,
    '',
    '## Revenue Signals',
    '',
  ];

  if (!digest.signals.length) {
    lines.push('No ranked revenue signals found on this page.', '');
  } else {
    digest.signals.forEach((signal, index) => {
      lines.push(`${index + 1}. ${signal.title}`);
      lines.push(`   - Score: ${signal.score}`);
      lines.push(`   - Category: ${signal.category || 'uncategorized'}`);
      lines.push(`   - Engagement: ${signal.upvotes} upvotes, ${signal.comments} comments`);
      lines.push(`   - URL: ${signal.url}`);
      lines.push(`   - Fit: ${signal.whyThumbGate}`);
      lines.push(`   - Action: ${signal.suggestedAction}`);
      if (signal.excerpt) lines.push(`   - Excerpt: ${signal.excerpt}`);
      lines.push('');
    });
  }

  lines.push('## Categories', '');
  digest.labels.forEach((label) => {
    lines.push(`- ${label.name}: ${label.postCount} posts`);
  });

  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args[key] = argv[index + 1];
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/skool-reader.js --community ai-automation-society --limit 10 --format json',
    '  node scripts/skool-reader.js --url https://www.skool.com/ai-automation-society --category "Support Needed" --signals --format markdown',
    '',
    'Options:',
    '  --community <slug>       Skool community slug.',
    '  --url <url>              Full Skool community or post URL.',
    '  --category <name|id>     Optional category name or Skool category id.',
    '  --limit <number>         Max raw posts or revenue signals to return.',
    '  --post-limit <number>    Max posts to read before signal ranking.',
    '  --format <json|markdown> Output format. Default: json.',
    '  --signals                Return revenue-signal digest instead of raw parsed posts.',
    '  --cookie-file <path>     Optional cookie header file for private groups.',
    '  --out <path>             Optional output file path.',
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const readOptions = { ...args };
  if (args.signals) {
    const signalLimit = asPositiveInt(args.limit, 10, 100);
    readOptions.limit = args.postLimit || Math.max(signalLimit, 50);
    args.signalLimit = args.signalLimit || signalLimit;
  }

  const parsed = await readSkoolCommunity(readOptions);
  const format = args.format || 'json';
  const payload = args.signals ? buildSkoolDigest(parsed, args) : parsed;
  const output = format === 'markdown'
    ? formatMarkdownDigest(args.signals ? payload : buildSkoolDigest(parsed, args))
    : `${JSON.stringify(payload, null, 2)}\n`;

  if (args.out) {
    fs.writeFileSync(path.resolve(args.out), output);
  } else {
    process.stdout.write(output);
  }
}

module.exports = {
  buildSkoolDigest,
  buildSkoolUrl,
  extractNextData,
  formatMarkdownDigest,
  loadCookieHeader,
  parseArgs,
  parseSkoolHtml,
  rankSkoolRevenueSignals,
  readSkoolCommunity,
  resolveCategoryId,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[skool-reader] ${error.message}\n`);
    process.exit(1);
  });
}
