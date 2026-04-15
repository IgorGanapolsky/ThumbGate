#!/usr/bin/env node
/**
 * Submit r/cursor launch post for ThumbGate using saved Reddit browser profile.
 * Run: node scripts/reddit-cursor-submit.js
 */

'use strict';

require('dotenv').config();

const { chromium } = require('playwright-core');
const path = require('path');

const REDDIT_PROFILE = path.resolve(process.env.HOME, '.thumbgate/browser_profiles/reddit');
const CHROME_EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SUBREDDIT = 'cursor';

const USERNAME = process.env.REDDIT_USERNAME || 'eazyigz123';
const PASSWORD = process.env.REDDIT_PASSWORD || 'Rockland26&*';

const TITLE = "Built an MCP layer that makes Cursor's mistakes self-correcting — one thumbs down and the same pattern can't happen again";

const BODY = `Cursor is great. But it has a memory problem: every session starts clean. If it generated a broken config yesterday and you fixed it, it'll generate the exact same broken config tomorrow. You can put rules in \`.cursorrules\`, but the agent isn't required to follow them — they're guidance, not enforcement.

I built **ThumbGate** to solve this. It's an MCP server that hooks into Cursor's tool execution layer and turns your 👍/👎 reactions into pre-action gates.

**The workflow:**

1. Cursor does something wrong (wrong import, broken config, risky edit)
2. You give it a 👎 with brief context
3. ThumbGate distills a lesson and — after enough similar failures — promotes it to a prevention rule
4. Next session, the PreToolUse hook fires before Cursor executes the same pattern: **⛔ blocked**

**Install:**

    npm install thumbgate
    npx thumbgate init --agent cursor

This wires four MCP skills into Cursor: feedback capture, rule management, lesson search, and session recall. All state lives locally in \`.thumbgate/\` — SQLite + FTS5, no external services.

**Real example from my own setup:**

I kept getting a broken \`tsconfig.json\` — wrong \`moduleResolution\` setting. Fixed it twice manually. Third time I gave it a 👎 with the context. ThumbGate generated a rule. Haven't seen the broken config since — that was three weeks ago.

**Free tier:** 3 feedback captures/day, 5 lesson searches/day, unlimited recall and enforcement. Pro is $19/mo if you want the visual gate debugger and dashboard.

This is six weeks old with ~2K npm cloners and zero paid users — posting here because Cursor users are exactly the audience I want real feedback from.

GitHub: https://github.com/IgorGanapolsky/ThumbGate
npm: https://www.npmjs.com/package/thumbgate
Landing: https://thumbgate-production.up.railway.app`;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function loginToReddit(page) {
  console.log('Logging into Reddit...');
  await page.goto('https://www.reddit.com/login', { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  await page.screenshot({ path: '/tmp/reddit-login-page.png' });
  console.log('Login page screenshot: /tmp/reddit-login-page.png');

  // Try to find username field
  const usernameInput = await page.$('input[name="username"], input[id*="username"], input[placeholder*="sername"]').catch(() => null);
  if (!usernameInput) {
    console.error('ERROR: Cannot find username input on login page. URL:', page.url());
    return false;
  }

  await usernameInput.click();
  await usernameInput.fill(USERNAME);

  const passwordInput = await page.$('input[type="password"]').catch(() => null);
  if (!passwordInput) {
    console.error('ERROR: Cannot find password input on login page.');
    return false;
  }

  await passwordInput.click();
  await passwordInput.fill(PASSWORD);
  await sleep(500);

  await page.screenshot({ path: '/tmp/reddit-login-filled.png' });

  // Submit
  const submitBtn = await page.$('button[type="submit"]').catch(() => null);
  if (submitBtn) {
    await submitBtn.click();
  } else {
    await passwordInput.press('Enter');
  }

  await sleep(5000);

  const postLoginUrl = page.url();
  const postLoginContent = await page.content().catch(() => '');
  console.log('Post-login URL:', postLoginUrl);

  await page.screenshot({ path: '/tmp/reddit-post-login.png' });
  console.log('Post-login screenshot: /tmp/reddit-post-login.png');

  if (postLoginContent.includes('Wrong') || postLoginContent.includes('incorrect') || postLoginContent.includes('Invalid')) {
    console.error('ERROR: Login failed — bad credentials or CAPTCHA required.');
    return false;
  }

  if (postLoginUrl.includes('reddit.com') && !postLoginUrl.includes('/login')) {
    console.log('Login successful! Landed at:', postLoginUrl);
    return true;
  }

  // May still be on login page due to 2FA or CAPTCHA
  console.log('WARNING: Still on login page. May need 2FA or CAPTCHA. URL:', postLoginUrl);
  return false;
}

async function submitPost(page) {
  const submitUrl = `https://www.reddit.com/r/${SUBREDDIT}/submit?type=TEXT`;
  console.log(`\nNavigating to ${submitUrl} ...`);
  await page.goto(submitUrl, { waitUntil: 'domcontentloaded' });
  await sleep(4000);

  const currentUrl = page.url();
  console.log('Submit page URL:', currentUrl);

  await page.screenshot({ path: '/tmp/reddit-submit-page.png' });
  console.log('Submit page screenshot: /tmp/reddit-submit-page.png');

  // If redirected to login, try to login
  if (currentUrl.includes('/login') || currentUrl.includes('account.reddit.com')) {
    console.log('Redirected to login. Attempting to log in...');
    const loggedIn = await loginToReddit(page);
    if (!loggedIn) {
      return false;
    }
    // Retry navigate to submit
    await page.goto(submitUrl, { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    await page.screenshot({ path: '/tmp/reddit-submit-retry.png' });
  }

  const finalUrl = page.url();
  console.log('Submit page (after potential login):', finalUrl);

  if (finalUrl.includes('/login')) {
    console.error('ERROR: Still on login page. Cannot proceed.');
    return false;
  }

  // Find the title textarea — Reddit new UI
  let titleInput = null;
  const titleSelectors = [
    'textarea[placeholder*="Title"]',
    'input[placeholder*="Title"]',
    '[data-testid="post-title"] textarea',
    'textarea[name="title"]',
    '.title-input textarea',
    'div[data-node-type="title"] textarea',
  ];

  for (const sel of titleSelectors) {
    titleInput = await page.$(sel).catch(() => null);
    if (titleInput) {
      console.log(`Found title input with selector: ${sel}`);
      break;
    }
  }

  if (!titleInput) {
    // Try clicking on the Text tab to switch to self-post
    const textTab = await page.$('button:has-text("Text"), [data-test-id="tab-text"]').catch(() => null);
    if (textTab) {
      await textTab.click();
      await sleep(1000);
      for (const sel of titleSelectors) {
        titleInput = await page.$(sel).catch(() => null);
        if (titleInput) break;
      }
    }
  }

  if (!titleInput) {
    const pageText = await page.textContent('body').catch(() => '');
    console.error('ERROR: Could not find title input on submit page.');
    console.error('Page text snippet:', pageText.substring(0, 600));
    return false;
  }

  // Fill title
  await titleInput.click();
  await titleInput.fill(TITLE);
  console.log('Title filled.');
  await sleep(500);

  // Fill body — Reddit uses a contenteditable div for the body
  const bodySelectors = [
    '.public-DraftEditor-content',
    '[contenteditable="true"][data-contents="true"]',
    '[data-testid="post-body"] .DraftEditor-root [contenteditable]',
    'textarea[placeholder*="body"], textarea[placeholder*="text"]',
    '.editor-container [contenteditable="true"]',
    '[class*="texteditor"] [contenteditable="true"]',
  ];

  let bodyInput = null;
  for (const sel of bodySelectors) {
    bodyInput = await page.$(sel).catch(() => null);
    if (bodyInput) {
      console.log(`Found body input with selector: ${sel}`);
      break;
    }
  }

  if (bodyInput) {
    await bodyInput.click();
    await sleep(300);
    // Type the body text
    await page.keyboard.type(BODY, { delay: 0 });
    console.log('Body filled.');
  } else {
    console.log('WARNING: Could not find body input area. Will submit title-only post.');
  }

  await sleep(1000);
  await page.screenshot({ path: '/tmp/reddit-before-submit.png' });
  console.log('Pre-submit screenshot: /tmp/reddit-before-submit.png');

  // Find Post / Submit button
  const submitSelectors = [
    'button[type="submit"]:has-text("Post")',
    'button:has-text("Post")',
    '[data-testid="submit-button"]',
    'button:has-text("Submit")',
  ];

  let submitBtn = null;
  for (const sel of submitSelectors) {
    submitBtn = await page.$(sel).catch(() => null);
    if (submitBtn) {
      console.log(`Found submit button with selector: ${sel}`);
      break;
    }
  }

  if (!submitBtn) {
    const allBtns = await page.$$eval('button', btns => btns.map(b => b.textContent?.trim())).catch(() => []);
    console.error('ERROR: Could not find Post/Submit button. Available buttons:', allBtns.join(' | '));
    return false;
  }

  console.log('Clicking Post button...');
  await submitBtn.click();
  await sleep(6000);

  const afterSubmitUrl = page.url();
  await page.screenshot({ path: '/tmp/reddit-after-submit.png' });
  console.log('Post-submit URL:', afterSubmitUrl);
  console.log('Post-submit screenshot: /tmp/reddit-after-submit.png');

  if (afterSubmitUrl.includes(`/r/${SUBREDDIT}/comments/`)) {
    console.log(`\n✅ POST SUBMITTED SUCCESSFULLY`);
    console.log(`Post URL: ${afterSubmitUrl}`);
    return true;
  }

  const afterText = await page.textContent('body').catch(() => '');
  if (afterText.includes('something went wrong') || afterText.includes('you are doing that too much')) {
    console.error('ERROR: Reddit rate limit or submission error.');
    return false;
  }

  console.log('Submission status unclear. Check screenshot at /tmp/reddit-after-submit.png');
  console.log('Final URL:', afterSubmitUrl);
  return afterSubmitUrl !== submitUrl;
}

async function run() {
  console.log('Launching Chrome with Reddit profile:', REDDIT_PROFILE);
  const context = await chromium.launchPersistentContext(REDDIT_PROFILE, {
    executablePath: CHROME_EXEC,
    headless: false,
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  const page = await context.newPage();

  try {
    const success = await submitPost(page);
    if (!success) {
      console.error('Post submission failed.');
      process.exitCode = 1;
    }
  } finally {
    await sleep(2000);
    await context.close();
  }
}

run().catch(err => {
  console.error('FATAL ERROR:', err.message);
  process.exit(1);
});
