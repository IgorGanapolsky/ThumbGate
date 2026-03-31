'use strict';

/**
 * Known bot user-agent patterns.
 * These are excluded from analytics and metrics.
 */
const BOT_PATTERNS = [
  /bot/i, /crawl/i, /spider/i, /slurp/i, /mediapartners/i,
  /Googlebot/i, /Bingbot/i, /DuckDuckBot/i, /Baiduspider/i,
  /YandexBot/i, /facebookexternalhit/i, /Twitterbot/i,
  /LinkedInBot/i, /WhatsApp/i, /Discordbot/i, /TelegramBot/i,
  /Applebot/i, /PetalBot/i, /SemrushBot/i, /AhrefsBot/i,
  /MJ12bot/i, /DotBot/i, /Bytespider/i,
  /GPTBot/i, /ChatGPT/i, /Claude/i, /Anthropic/i, /Perplexity/i,
  /Google-Extended/i, /CCBot/i, /cohere-ai/i,
  /HeadlessChrome/i, /PhantomJS/i, /Puppeteer/i, /Playwright/i,
  /python-requests/i, /axios/i, /node-fetch/i, /curl/i, /wget/i,
  /Scrapy/i, /HttpClient/i, /Java\//i, /Go-http-client/i,
  /Monitoring/i, /UptimeRobot/i, /Pingdom/i, /StatusCake/i,
  /Railway/i,
];

/**
 * Known internal/owner identifiers
 */
const OWNER_EMAILS = [
  'iganapolsky@gmail.com',
  'ig5973700@gmail.com',
  'igor@',
];

const OWNER_IPS = []; // Add known IPs if available

/**
 * Classify a request as 'bot', 'owner', or 'real_user'
 */
function classifyVisitor(req) {
  const ua = (req.headers && req.headers['user-agent']) || '';
  const email = req.email || req.query?.email || '';
  const ip = req.headers?.['x-forwarded-for'] || req.ip || '';

  // Check bot patterns
  for (const pattern of BOT_PATTERNS) {
    if (pattern.test(ua)) {
      return { type: 'bot', reason: `UA matches: ${pattern}`, userAgent: ua };
    }
  }

  // Check empty/missing user-agent (likely automated)
  if (!ua || ua.length < 10) {
    return { type: 'bot', reason: 'Empty or short user-agent', userAgent: ua };
  }

  // Check owner emails
  for (const ownerEmail of OWNER_EMAILS) {
    if (email && email.toLowerCase().includes(ownerEmail.toLowerCase())) {
      return { type: 'owner', reason: `Email matches: ${ownerEmail}`, userAgent: ua };
    }
  }

  return { type: 'real_user', reason: 'No bot pattern matched', userAgent: ua };
}

/**
 * Express/Connect middleware that tags requests with visitor classification
 */
function botFilterMiddleware(req, res, next) {
  req.visitorClass = classifyVisitor(req);
  next();
}

/**
 * Check if a request should be excluded from analytics
 */
function shouldExcludeFromAnalytics(req) {
  const classification = req.visitorClass || classifyVisitor(req);
  return classification.type === 'bot';
}

module.exports = { classifyVisitor, botFilterMiddleware, shouldExcludeFromAnalytics, BOT_PATTERNS, OWNER_EMAILS };
