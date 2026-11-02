'use strict';

/**
 * UTM link builder utility for social posts.
 *
 * Provides helpers for constructing tracked URLs to use in social content,
 * with pre-built platform link sets and a placeholder for dub.co shortening.
 */

/**
 * Appends UTM parameters to a base URL.
 * Handles existing query strings gracefully.
 *
 * @param {string} baseUrl - The destination URL to annotate.
 * @param {{ source: string, medium?: string, campaign: string, content?: string }} options
 * @returns {string} URL with UTM query parameters appended.
 */
function buildUTMLink(baseUrl, {
  source,
  medium = 'social',
  campaign,
  content,
  term,
  creator,
  community,
  postId,
  commentId,
  campaignVariant,
  offerCode,
  experimentId,
  ref,
} = {}) {
  if (!baseUrl) throw new Error('buildUTMLink: baseUrl is required');
  if (!source) throw new Error('buildUTMLink: source is required');
  if (!campaign) throw new Error('buildUTMLink: campaign is required');

  const url = new URL(baseUrl);
  url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', medium);
  url.searchParams.set('utm_campaign', campaign);
  if (content) url.searchParams.set('utm_content', content);
  if (term) url.searchParams.set('utm_term', term);
  if (creator) url.searchParams.set('creator', creator);
  if (community) url.searchParams.set('community', community);
  if (postId) url.searchParams.set('post_id', postId);
  if (commentId) url.searchParams.set('comment_id', commentId);
  if (campaignVariant) url.searchParams.set('campaign_variant', campaignVariant);
  if (offerCode) url.searchParams.set('offer_code', offerCode);
  if (experimentId) url.searchParams.set('experiment_id', experimentId);
  if (ref) url.searchParams.set('ref', ref);
  return url.toString();
}

function buildSocialLinks(baseUrl, campaign, extraOptions = {}) {
  if (!baseUrl) throw new Error('buildSocialLinks: baseUrl is required');
  if (!campaign) throw new Error('buildSocialLinks: campaign is required');

  const platforms = [
    'instagram',
    'tiktok',
    'x',
    'github',
    'reddit',
    'zernio',
    'linkedin',
    'bluesky',
    'threads',
    'hackernews',
    'youtube',
    'devto',
    'substack',
  ];
  const result = {};
  for (const platform of platforms) {
    result[platform] = buildUTMLink(baseUrl, {
      ...extraOptions,
      source: platform,
      medium: extraOptions.medium || 'social',
      campaign,
    });
  }
  return result;
}

/**
 * Known trackable domains — URLs matching these will have UTM params injected.
 */
const TRACKABLE_DOMAINS = [
  'thumbgate.ai',
  'thumbgate-production.up.railway.app',
  'github.com/IgorGanapolsky/ThumbGate',
  'github.com/IgorGanapolsky/thumbgate',
];

/**
 * Replace raw trackable URLs in text with UTM-tagged versions.
 *
 * Scans the input for URLs containing any of the known trackable domains
 * and appends UTM parameters to them.
 *
 * @param {string} text - The content to scan for URLs.
 * @param {{ source: string, medium?: string, campaign: string }} utmOptions
 * @returns {string} Text with trackable URLs replaced by UTM-tagged versions.
 */
function tagUrlsInText(text, utmOptions = {}) {
  if (!text) return text;
  const { source, medium = 'social', campaign } = utmOptions;

  // Match http(s) URLs
  const urlPattern = /https?:\/\/[^\s)"\]]+/g;

  return text.replace(urlPattern, (match) => {
    const isTrackable = TRACKABLE_DOMAINS.some((domain) => match.includes(domain));
    if (!isTrackable) return match;

    try {
      return buildUTMLink(match, { ...utmOptions, source, medium, campaign });
    } catch {
      // If URL parsing fails, return the original
      return match;
    }
  });
}

function parseAndRepairInboundAttribution(urlOrSearch = '') {
  const rawText = String(urlOrSearch || '').trim().replace(/&amp;/gi, '&');
  if (!rawText) return {};
  let queryString = rawText;
  try {
    if (/^https?:\/\//i.test(rawText)) {
      queryString = new URL(rawText).search;
    }
  } catch (_) {}
  const params = new URLSearchParams(queryString.startsWith('?') ? queryString.slice(1) : queryString);
  const out = {};
  const keys = [
    ['utm_source', 'utmSource'],
    ['utm_medium', 'utmMedium'],
    ['utm_campaign', 'utmCampaign'],
    ['utm_content', 'utmContent'],
    ['utm_term', 'utmTerm'],
    ['creator', 'creator'],
    ['community', 'community'],
    ['subreddit', 'community'],
    ['post_id', 'postId'],
    ['comment_id', 'commentId'],
    ['campaign_variant', 'campaignVariant'],
    ['variant', 'campaignVariant'],
    ['offer_code', 'offerCode'],
    ['experiment_id', 'experimentId'],
    ['ref', 'referredByVisitorId'],
    ['referred_by', 'referredByVisitorId'],
    ['inviter_id', 'referredByVisitorId'],
  ];
  for (const [paramKey, fieldKey] of keys) {
    const val = params.get(paramKey);
    if (val && !out[fieldKey]) {
      out[fieldKey] = String(val).replace(/\\+$/g, '').trim();
    }
  }
  return out;
}

/**
 * Placeholder for dub.co link shortening.
 * Returns the original long URL as-is until a shortening provider is enabled.
 *
 * To activate: set DUB_API_KEY in the environment and call
 * POST https://api.dub.co/links with { url: longUrl, domain: 'dub.sh' }.
 *
 * @param {string} longUrl - The full URL to shorten.
 * @returns {Promise<string>} The longUrl unchanged (no-op placeholder).
 */
async function shortenWithDub(longUrl) {
  // Deliberate no-op until a shortening provider is enabled for this pipeline.
  // Example future implementation: POST https://api.dub.co/links with Bearer DUB_API_KEY.
  return longUrl;
}

module.exports = {
  buildUTMLink,
  buildSocialLinks,
  parseAndRepairInboundAttribution,
  shortenWithDub,
  tagUrlsInText,
  TRACKABLE_DOMAINS,
};

// Allow running directly:
//   node scripts/social-analytics/utm.js --url https://example.com --campaign spring-promo
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : null;
  };

  const url = get('--url');
  const campaign = get('--campaign');

  if (!url || !campaign) {
    console.error('Usage: node utm.js --url <baseUrl> --campaign <campaign>');
    process.exit(1);
  }

  const links = buildSocialLinks(url, campaign);
  console.log('Social UTM links for campaign:', campaign);
  console.log(JSON.stringify(links, null, 2));
}
