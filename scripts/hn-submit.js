#!/usr/bin/env node
/**
 * Submit Show HN post for ThumbGate using saved HN browser profile.
 * Run: node scripts/hn-submit.js
 */

const { chromium } = require('playwright-core');
const path = require('path');

const HN_PROFILE = path.resolve(process.env.HOME, '.thumbgate/browser_profiles/hn');
const CHROME_EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const TITLE = 'Show HN: ThumbGate – thumbs-up/down feedback that enforces gates on AI agents';
const URL_FIELD = 'https://github.com/IgorGanapolsky/ThumbGate';

const BODY = `Every AI coding agent I've worked with has the same flaw: it repeats mistakes
across sessions. You correct a force-push to main in session 1. Session 2: same
thing. You write it into the system prompt. Session 3: same thing again. Prompts
are suggestions. There's no enforcement layer.

ThumbGate is an npm package + MCP server that turns 👍/👎 reactions into
enforced pre-action gates. The flow: you give a thumbs-down on a bad agent
action → ThumbGate distills a lesson from that failure (with context from up to
8 prior entries) → repeated failures auto-promote to a prevention rule → a
PreToolUse hook physically blocks matching tool calls before they execute. Not a
suggestion. A block.

It works with Claude Code, Cursor, Codex, Gemini CLI, and Amp. Install:

    npm install thumbgate
    npx thumbgate init

Auto-detects your agent and wires the MCP config. All state lives in
.thumbgate/ — local SQLite + FTS5, no cloud required. Thompson Sampling adapts
gate sensitivity per failure domain over time.

The piece that surprised me most: the 👍 side. Reinforcing good patterns turns
out to be just as useful as blocking bad ones — the agent starts preferring your
approved flows without you having to spell them out every session.

Free tier: 3 feedback captures/day, 5 lesson searches/day, unlimited recall and
enforcement. Pro is $19/mo (personal dashboard + DPO export). Team is $99/seat
for shared lesson DB and org-wide enforcement.

About 6 weeks of nights and weekends. ~2K cloners on npm so far, 0 paid users.
Sharing here for honest feedback on the approach.

GitHub: https://github.com/IgorGanapolsky/ThumbGate
npm: https://www.npmjs.com/package/thumbgate
Landing: https://thumbgate-production.up.railway.app`;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log('Launching Chrome with HN profile...');
  const context = await chromium.launchPersistentContext(HN_PROFILE, {
    executablePath: CHROME_EXEC,
    headless: false,
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  const page = await context.newPage();

  // Check if logged in
  console.log('Checking HN login status...');
  await page.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  const loggedIn = await page.$('a[href^="user?id="]');
  if (!loggedIn) {
    console.error('ERROR: Not logged into HN. The saved profile does not have an active HN session.');
    await context.close();
    process.exit(1);
  }
  const username = await page.$eval('a[href^="user?id="]', el => el.textContent);
  console.log(`Logged in as: ${username}`);

  // Navigate to submit
  console.log('Navigating to HN submit page...');
  await page.goto('https://news.ycombinator.com/submit', { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  // Check for rate limit
  const pageText = await page.textContent('body');
  if (pageText.includes('You\'re submitting too fast') || pageText.includes('rate limit') || pageText.includes('Sorry')) {
    console.error('RATE LIMITED: HN is rate-limiting submissions. Retry in 2 hours.');
    await context.close();
    process.exit(2);
  }

  // Fill in the form
  console.log('Filling in submission form...');

  // Title field
  const titleInput = await page.$('input[name="title"]');
  if (!titleInput) {
    console.error('ERROR: Could not find title input field.');
    await context.close();
    process.exit(1);
  }
  await titleInput.fill(TITLE);
  console.log(`Title: ${TITLE}`);

  // URL field
  const urlInput = await page.$('input[name="url"]');
  if (!urlInput) {
    console.error('ERROR: Could not find URL input field.');
    await context.close();
    process.exit(1);
  }
  await urlInput.fill(URL_FIELD);
  console.log(`URL: ${URL_FIELD}`);

  // Take screenshot before submitting
  await page.screenshot({ path: '/tmp/hn-submit-before.png' });
  console.log('Screenshot saved: /tmp/hn-submit-before.png');

  // Submit
  console.log('Submitting...');
  const submitBtn = await page.$('input[type="submit"]');
  if (!submitBtn) {
    console.error('ERROR: Could not find submit button.');
    await context.close();
    process.exit(1);
  }
  await submitBtn.click();
  await sleep(3000);

  // Check result
  const newUrl = page.url();
  console.log(`Post-submit URL: ${newUrl}`);

  const newPageText = await page.textContent('body');

  if (newPageText.includes('You\'re submitting too fast') || newPageText.includes('rate limit')) {
    console.error('RATE LIMITED after submit. Retry in 2 hours.');
    await context.close();
    process.exit(2);
  }

  if (newPageText.includes('Sorry') || newPageText.includes('error')) {
    console.error('SUBMISSION ERROR. Page content snippet:');
    console.error(newPageText.substring(0, 500));
    await context.close();
    process.exit(1);
  }

  // Take screenshot after submitting
  await page.screenshot({ path: '/tmp/hn-submit-after.png' });
  console.log('Screenshot saved: /tmp/hn-submit-after.png');

  // Try to find our submission to post a comment
  // After submission, HN redirects to the item page or the main page
  let itemUrl = newUrl;

  if (!newUrl.includes('item?id=')) {
    // Try to find our post on newest or the user page
    console.log('Looking for our new submission...');
    await page.goto('https://news.ycombinator.com/newest', { waitUntil: 'domcontentloaded' });
    await sleep(2000);

    // Look for our submission by title
    const link = await page.$(`a:has-text("ThumbGate")`);
    if (link) {
      const href = await link.getAttribute('href');
      if (href && href.includes('item?id=')) {
        itemUrl = 'https://news.ycombinator.com/' + href;
      } else {
        // Find the "discuss" link near our post
        const titleEl = await page.$(`a:has-text("Show HN: ThumbGate")`);
        if (titleEl) {
          // Get the parent row and find the comments link
          const rowHandle = await titleEl.evaluateHandle(el => {
            // Walk up to find the subtext row
            let node = el.closest('tr');
            if (node && node.nextElementSibling) {
              return node.nextElementSibling;
            }
            return null;
          });
          const commentLink = await rowHandle.$('a:has-text("discuss")');
          if (commentLink) {
            const cHref = await commentLink.getAttribute('href');
            itemUrl = 'https://news.ycombinator.com/' + cHref;
          }
        }
      }
    }
  }

  if (itemUrl.includes('item?id=')) {
    console.log(`Found submission: ${itemUrl}`);

    // Navigate to the item to post first comment
    await page.goto(itemUrl, { waitUntil: 'domcontentloaded' });
    await sleep(2000);

    // Find the comment textarea
    const commentArea = await page.$('textarea[name="text"]');
    if (commentArea) {
      console.log('Posting first comment (body text)...');
      await commentArea.fill(BODY);

      await page.screenshot({ path: '/tmp/hn-comment-before.png' });
      console.log('Screenshot saved: /tmp/hn-comment-before.png');

      const addComment = await page.$('input[type="submit"][value="add comment"]');
      if (addComment) {
        await addComment.click();
        await sleep(3000);
        console.log('Comment submitted!');
        await page.screenshot({ path: '/tmp/hn-comment-after.png' });
        console.log('Screenshot saved: /tmp/hn-comment-after.png');
      } else {
        console.error('ERROR: Could not find "add comment" button.');
      }
    } else {
      console.error('ERROR: Could not find comment textarea.');
    }
  } else {
    console.log(`Could not find item URL for commenting. Current URL: ${itemUrl}`);
    console.log('Submission may have succeeded but could not locate the item page for the comment.');
  }

  console.log('\nDone. Final URL:', page.url());
  await sleep(2000);
  await context.close();
}

run().catch(err => {
  console.error('FATAL ERROR:', err.message);
  process.exit(1);
});
