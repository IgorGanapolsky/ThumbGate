'use strict';

/**
 * LinkedIn comment publisher — posts a comment on an existing activity
 * via the socialActions endpoint.
 *
 * Required environment variables:
 *   LINKEDIN_ACCESS_TOKEN  — OAuth 2.0 access token with w_member_social scope
 *   LINKEDIN_PERSON_URN    — Authenticated member URN, e.g. urn:li:person:XXXXX
 *
 * LinkedIn API reference:
 *   https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/network-update-social-actions#create-a-comment
 *
 * Usage (CLI):
 *   LINKEDIN_ACCESS_TOKEN=... LINKEDIN_PERSON_URN=urn:li:person:XXX \
 *     node linkedin-comment.js \
 *       --activity=urn:li:activity:7450534811640782848 \
 *       --text="your comment body here"
 */

const LI_REST_BASE = 'https://api.linkedin.com/rest';

/* Strip CR/LF and other control chars from values before they hit console.log
 * so attacker-controlled text (comment body, URN, error messages) cannot forge
 * fake log lines. Addresses SonarCloud S5145/javascript:S6564 log-injection. */
function safeForLog(value) {
  return String(value ?? '').replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ').slice(0, 500);
}

function buildHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': '202601',
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
  };
}

/**
 * Posts a text comment on an existing LinkedIn activity (post/share/ugc).
 *
 * @param {string} token        - LinkedIn OAuth access token (w_member_social scope).
 * @param {string} personUrn    - Commenting member URN (the `actor`).
 * @param {string} activityUrn  - Target activity URN, e.g. "urn:li:activity:7450534811640782848".
 * @param {string} text         - Comment body.
 * @returns {Promise<object>}   - The created comment object (incl. `$URN`).
 */
async function publishComment(token, personUrn, activityUrn, text) {
  if (!token) throw new Error('publishComment: token is required');
  if (!personUrn) throw new Error('publishComment: personUrn is required');
  if (!activityUrn) throw new Error('publishComment: activityUrn is required');
  if (!text) throw new Error('publishComment: text is required');

  // LinkedIn's socialActions path segment must be URL-encoded because the URN
  // itself contains colons (`urn:li:activity:...`).
  const encodedActivity = encodeURIComponent(activityUrn);
  const url = `${LI_REST_BASE}/socialActions/${encodedActivity}/comments`;

  const body = {
    actor: personUrn,
    object: activityUrn,
    message: { text },
  };

  console.log(`[linkedin:comment] POST ${safeForLog(url)}`);
  console.log(`[linkedin:comment]   actor  = ${safeForLog(personUrn)}`);
  console.log(`[linkedin:comment]   object = ${safeForLog(activityUrn)}`);
  console.log(`[linkedin:comment]   text   = "${safeForLog(text.slice(0, 80))}${text.length > 80 ? '…' : ''}"`);

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`publishComment HTTP ${res.status}: ${errBody.slice(0, 600)}`);
  }

  // LinkedIn returns the created comment JSON; URN may be in body or header.
  const headerUrn = res.headers.get('x-restli-id') ?? res.headers.get('X-RestLi-Id') ?? null;
  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = {};
  }
  const commentUrn = payload?.$URN ?? payload?.urn ?? headerUrn ?? '(urn not returned)';
  console.log(`[linkedin:comment] ✅ Created: ${safeForLog(commentUrn)}`);
  return { urn: commentUrn, payload };
}

module.exports = { publishComment, safeForLog, buildHeaders, LI_REST_BASE };

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

  const activityUrn = getArg('--activity');
  const text = getArg('--text');

  if (!activityUrn || !text) {
    console.error('Usage: node linkedin-comment.js --activity=urn:li:activity:XXX --text="<comment>"');
    process.exit(1);
  }

  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const personUrn = process.env.LINKEDIN_PERSON_URN;
  if (!token) { console.error('LINKEDIN_ACCESS_TOKEN is not set'); process.exit(1); }
  if (!personUrn) { console.error('LINKEDIN_PERSON_URN is not set'); process.exit(1); }

  (async () => {
    try {
      const { urn } = await publishComment(token, personUrn, activityUrn, text);
      console.log(`[linkedin:comment] Done. Comment URN: ${safeForLog(urn)}`);
    } catch (err) {
      console.error('[linkedin:comment] Failed:', safeForLog(err.message));
      process.exit(1);
    }
  })();
}
