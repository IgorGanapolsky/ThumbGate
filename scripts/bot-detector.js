'use strict';

const BOT_PATTERNS = [
  /bot/i, /crawl/i, /spider/i, /slurp/i, /mediapartners/i,
  /Googlebot/i, /Bingbot/i, /DuckDuckBot/i, /Baiduspider/i,
  /YandexBot/i, /facebookexternalhit/i, /Twitterbot/i,
  /LinkedInBot/i, /WhatsApp/i, /Discordbot/i, /TelegramBot/i,
  /Applebot/i, /PetalBot/i, /SemrushBot/i, /AhrefsBot/i,
  /MJ12bot/i, /DotBot/i, /Bytespider/i,
  /GPTBot/i, /ChatGPT/i, /Claude-SearchBot/i, /Anthropic/i, /Perplexity/i,
  /Google-Extended/i, /CCBot/i, /cohere-ai/i,
  /HeadlessChrome/i, /PhantomJS/i, /Puppeteer/i, /Playwright/i,
  /python-requests/i, /node-fetch/i, /wget/i,
  /Scrapy/i, /HttpClient/i, /Go-http-client/i,
  /UptimeRobot/i, /Pingdom/i, /StatusCake/i,
];

const OWNER_EMAILS = ['iganapolsky@gmail.com', 'ig5973700@gmail.com'];

function classifyVisitor(req) {
  const ua = (req.headers && req.headers['user-agent']) || '';
  const email = req.email || (req.query && req.query.email) || '';

  for (const pattern of BOT_PATTERNS) {
    if (pattern.test(ua)) {
      return { type: 'bot', reason: `UA matches: ${pattern}`, userAgent: ua };
    }
  }
  if (!ua || ua.length < 10) {
    return { type: 'bot', reason: 'Empty or short user-agent', userAgent: ua };
  }
  for (const ownerEmail of OWNER_EMAILS) {
    if (email && email.toLowerCase().includes(ownerEmail.toLowerCase())) {
      return { type: 'owner', reason: `Email matches: ${ownerEmail}`, userAgent: ua };
    }
  }
  return { type: 'real_user', reason: 'No bot pattern matched', userAgent: ua };
}

function shouldExcludeFromAnalytics(req) {
  const classification = req.visitorClass || classifyVisitor(req);
  return classification.type === 'bot';
}

function botFilterMiddleware(req, res, next) {
  req.visitorClass = classifyVisitor(req);
  next();
}

module.exports = { classifyVisitor, botFilterMiddleware, shouldExcludeFromAnalytics, BOT_PATTERNS, OWNER_EMAILS };
