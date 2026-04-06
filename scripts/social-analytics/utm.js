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
function buildUTMLink(baseUrl, { source, medium = 'social', campaign, content } = {}) {
  if (!baseUrl) throw new Error('buildUTMLink: baseUrl is required');
  if (!source) throw new Error('buildUTMLink: source is required');
  if (!campaign) throw new Error('buildUTMLink: campaign is required');

  const url = new URL(baseUrl);
  url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', medium);
  url.searchParams.set('utm_campaign', campaign);
  if (content) {
    url.searchParams.set('utm_content', content);
  }
  return url.toString();
}

/**
 * Returns a pre-built set of tracked links for each social platform.
 *
 * @param {string} baseUrl - The destination URL.
 * @param {string} campaign - The campaign name (e.g. 'launch-v2', 'spring-promo').
 * @returns {{
 *   instagram: string,
 *   tiktok: string,
 *   x: string,
 *   github: string,
 *   reddit: string,
 *   zernio: string,
 * }}
 */
function buildSocialLinks(baseUrl, campaign) {
  if (!baseUrl) throw new Error('buildSocialLinks: baseUrl is required');
  if (!campaign) throw new Error('buildSocialLinks: campaign is required');

  return {
    instagram: buildUTMLink(baseUrl, { source: 'instagram', medium: 'social', campaign }),
    tiktok: buildUTMLink(baseUrl, { source: 'tiktok', medium: 'social', campaign }),
    x: buildUTMLink(baseUrl, { source: 'x', medium: 'social', campaign }),
    github: buildUTMLink(baseUrl, { source: 'github', medium: 'social', campaign }),
    reddit: buildUTMLink(baseUrl, { source: 'reddit', medium: 'social', campaign }),
    zernio: buildUTMLink(baseUrl, { source: 'zernio', medium: 'social', campaign }),
  };
}

/**
 * Known trackable domains — URLs matching these will have UTM params injected.
 */
const TRACKABLE_DOMAINS = [
  'thumbgate-production.up.railway.app',
  'github.com/IgorGanapolsky/ThumbGate',
  'github.com/IgorGanapolsky/mcp-memory-gateway',
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
function tagUrlsInText(text, { source, medium = 'social', campaign }) {
  if (!text) return text;

  // Match http(s) URLs
  const urlPattern = /https?:\/\/[^\s)"\]]+/g;

  return text.replace(urlPattern, (match) => {
    const isTrackable = TRACKABLE_DOMAINS.some((domain) => match.includes(domain));
    if (!isTrackable) return match;

    try {
      return buildUTMLink(match, { source, medium, campaign });
    } catch {
      // If URL parsing fails, return the original
      return match;
    }
  });
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
