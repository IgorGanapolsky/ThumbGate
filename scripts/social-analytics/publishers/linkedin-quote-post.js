'use strict';

/**
 * LinkedIn quote-post publisher — publishes a standalone post on the
 * authenticated member's feed that reshares (quote-posts) a target activity
 * with original commentary.
 *
 * Used when we want to engage with a thought-leader post but cannot use the
 * Community Management API `socialActions/{urn}/comments` endpoint (which
 * requires a separate product approval on the LinkedIn app). A quote-post
 * notifies the original author (via URN reference), appears in our feed with
 * their post embedded, and requires only `w_member_social` — the same scope
 * the existing "Share on LinkedIn" product already grants.
 *
 * Required environment variables:
 *   LINKEDIN_ACCESS_TOKEN  — OAuth 2.0 access token with w_member_social scope
 *   LINKEDIN_PERSON_URN    — Authenticated member URN, e.g. urn:li:person:XXXXX
 *
 * LinkedIn API reference:
 *   https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/posts-api#reshare-a-post
 *
 * Usage (CLI):
 *   LINKEDIN_ACCESS_TOKEN=... LINKEDIN_PERSON_URN=urn:li:person:XXX \
 *     node linkedin-quote-post.js \
 *       --parent=urn:li:activity:7450534811640782848 \
 *       --text="your commentary here"
 */

const { safeForLog, buildHeaders, LI_REST_BASE } = require('./linkedin-comment');

/**
 * Publishes a quote-post (reshare with commentary) on the authenticated
 * member's feed.
 *
 * @param {string} token       - LinkedIn OAuth access token (w_member_social).
 * @param {string} personUrn   - Author URN, e.g. "urn:li:person:XXXXX".
 * @param {string} parentUrn   - Target activity URN being quote-posted.
 * @param {string} text        - Commentary body (shown above the embedded post).
 * @returns {Promise<{urn: string}>} - Created post URN from X-RestLi-Id header.
 */
async function publishQuotePost(token, personUrn, parentUrn, text) {
  if (!token) throw new Error('publishQuotePost: token is required');
  if (!personUrn) throw new Error('publishQuotePost: personUrn is required');
  if (!parentUrn) throw new Error('publishQuotePost: parentUrn is required');
  if (!text) throw new Error('publishQuotePost: text is required');

  const url = `${LI_REST_BASE}/posts`;
  const body = {
    author: personUrn,
    commentary: text,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED' },
    lifecycleState: 'PUBLISHED',
    reshareContext: { parent: parentUrn },
  };

  console.log(`[linkedin:quote-post] POST ${safeForLog(url)}`);
  console.log(`[linkedin:quote-post]   author = ${safeForLog(personUrn)}`);
  console.log(`[linkedin:quote-post]   parent = ${safeForLog(parentUrn)}`);
  console.log(`[linkedin:quote-post]   text   = "${safeForLog(text.slice(0, 80))}${text.length > 80 ? '…' : ''}"`);

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`publishQuotePost HTTP ${res.status}: ${errBody.slice(0, 600)}`);
  }

  const postUrn = res.headers.get('x-restli-id') ?? res.headers.get('X-RestLi-Id') ?? '(urn not returned)';
  console.log(`[linkedin:quote-post] ✅ Created: ${safeForLog(postUrn)}`);
  return { urn: postUrn };
}

module.exports = { publishQuotePost };

// ---------------------------------------------------------------------------
// Stand-alone execution
// ---------------------------------------------------------------------------
if (require.main?.filename === __filename) {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const prefix = `${flag}=`;
    const entry = args.find((a) => a.startsWith(prefix));
    return entry ? entry.slice(prefix.length) : null;
  };

  const parentUrn = getArg('--parent');
  const text = getArg('--text');

  if (!parentUrn || !text) {
    console.error('Usage: node linkedin-quote-post.js --parent=urn:li:activity:XXX --text="<commentary>"');
    process.exit(1);
  }

  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const personUrn = process.env.LINKEDIN_PERSON_URN;
  if (!token) { console.error('LINKEDIN_ACCESS_TOKEN is not set'); process.exit(1); }
  if (!personUrn) { console.error('LINKEDIN_PERSON_URN is not set'); process.exit(1); }

  (async () => {
    try {
      const { urn } = await publishQuotePost(token, personUrn, parentUrn, text);
      console.log(`[linkedin:quote-post] Done. Post URN: ${safeForLog(urn)}`);
    } catch (err) {
      console.error('[linkedin:quote-post] Failed:', safeForLog(err.message));
      process.exit(1);
    }
  })();
}
