'use strict';

/**
 * Perplexity Max Marketing Engine
 *
 * Uses Perplexity Sonar APIs to:
 * 1. Deep Research — find buyers, competitors, distribution channels
 * 2. Search API — find live discussions where MCP Memory Gateway is relevant
 * 3. Sonar Pro — generate SEO-optimized launch posts for HN, Reddit, dev.to, Twitter
 * 4. Generate ready-to-post content with links to purchase channels
 *
 * Usage:
 *   PERPLEXITY_API_KEY=pplx-... node scripts/perplexity-marketing.js [command]
 *
 * Commands:
 *   research     — Deep research on target market and competitors
 *   find-threads — Find live discussions to engage with
 *   generate     — Generate launch posts for all platforms
 *   full         — Run all three steps (default)
 */

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.PERPLEXITY_API_KEY;
const OUTPUT_DIR = path.join(__dirname, '..', '.amp', 'in', 'artifacts', 'marketing');
const SONAR_URL = 'https://api.perplexity.ai/chat/completions';

const PRODUCT = {
  name: 'MCP Memory Gateway',
  npm: 'mcp-memory-gateway',
  repo: 'https://github.com/IgorGanapolsky/mcp-memory-gateway',
  gumroad: 'https://gumroad.com/igorganapolsky',
  sponsor: 'https://github.com/sponsors/IgorGanapolsky',
  coffee: 'https://buymeacoffee.com/igorganapolsky',
  tagline: 'Local-first memory and feedback pipeline for AI agents. Captures thumbs-up/down signals, promotes reusable memories, generates prevention rules from repeated failures, and exports KTO/DPO pairs for fine-tuning.',
  keywords: ['MCP', 'RLHF', 'DPO', 'KTO', 'Thompson Sampling', 'AI agent memory', 'Claude Code', 'Amp', 'Gemini CLI', 'context engineering', 'prevention rules', 'Veto Layer'],
  proPrice: '$49 one-time',
};

async function sonarRequest(model, messages, options = {}) {
  if (!API_KEY) {
    throw new Error('PERPLEXITY_API_KEY not set. Get yours at https://www.perplexity.ai/settings/api');
  }

  const body = {
    model,
    messages,
    ...options,
  };

  const resp = await fetch(SONAR_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Perplexity API ${resp.status}: ${text}`);
  }

  return resp.json();
}

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function saveOutput(filename, content) {
  ensureOutputDir();
  const p = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(p, content, 'utf-8');
  console.log(`  ✓ Saved: ${p}`);
  return p;
}

// ─── STEP 1: Deep Research ────────────────────────────────────────────────────

async function deepResearch() {
  console.log('\n🔬 STEP 1: Deep Research — Market Analysis');
  console.log('  Using sonar-deep-research for exhaustive analysis...\n');

  const result = await sonarRequest('sonar-deep-research', [
    {
      role: 'system',
      content: 'You are a market research analyst specializing in developer tools and AI infrastructure. Provide actionable intelligence with specific URLs, communities, and buyer personas.',
    },
    {
      role: 'user',
      content: `Research the market for MCP (Model Context Protocol) memory and feedback tools for AI coding agents.

I built "${PRODUCT.name}" — ${PRODUCT.tagline}

Research and provide:
1. **Competitor Analysis**: What similar tools exist? (LangSmith, Weights & Biases, custom RLHF pipelines, etc.) What do they charge? What gaps does my tool fill?
2. **Target Buyer Personas**: Who would pay $49 one-time for a Pro plan with curated RLHF configs? (AI engineers, dev tool builders, agent framework users)
3. **Distribution Channels**: Specific subreddits, Discord servers, Slack communities, newsletters, and forums where MCP/RLHF tool buyers hang out. Include URLs.
4. **SEO/GEO Keywords**: High-intent search terms people use when looking for this type of tool
5. **Launch Strategy**: Specific steps to get first 10 paying customers this week
6. **Pricing Validation**: Is $49 one-time right for a Pro plan? What would similar tools charge?

Be specific with URLs, community names, and actionable steps.`,
    },
  ]);

  const content = result.choices[0].message.content;
  const citations = result.citations || [];

  let output = `# Market Research Report — MCP Memory Gateway\n\nGenerated: ${new Date().toISOString()}\n\n`;
  output += content;
  if (citations.length) {
    output += '\n\n## Sources\n\n';
    citations.forEach((c, i) => { output += `${i + 1}. ${c}\n`; });
  }

  saveOutput('01-deep-research.md', output);
  console.log('  ✓ Deep research complete\n');
  return content;
}

// ─── STEP 2: Find Live Discussions ───────────────────────────────────────────

async function findThreads() {
  console.log('\n🔍 STEP 2: Find Live Discussions to Engage');
  console.log('  Using sonar-pro to find active conversations...\n');

  const queries = [
    'MCP Model Context Protocol memory tools discussion site:reddit.com OR site:news.ycombinator.com 2025 2026',
    'RLHF feedback loop AI agents local-first tools discussion',
    'Claude Code Amp agent memory context engineering tips',
    'AI coding agent prevention rules guardrails DPO training',
  ];

  const results = [];

  for (const q of queries) {
    try {
      const result = await sonarRequest('sonar-pro', [
        {
          role: 'system',
          content: 'Find active online discussions, forum threads, and community posts. Return specific URLs where people are discussing these topics. Focus on posts from the last 30 days.',
        },
        { role: 'user', content: q },
      ], {
        web_search_options: { search_context_size: 'high' },
      });

      const content = result.choices[0].message.content;
      const citations = result.citations || [];
      results.push({ query: q, content, citations });
    } catch (err) {
      console.log(`  ⚠ Query failed: ${q} — ${err.message}`);
    }
  }

  let output = `# Live Discussion Threads — Engagement Opportunities\n\nGenerated: ${new Date().toISOString()}\n\n`;
  for (const r of results) {
    output += `## Query: ${r.query}\n\n${r.content}\n\n`;
    if (r.citations.length) {
      output += '### Sources\n';
      r.citations.forEach((c, i) => { output += `${i + 1}. ${c}\n`; });
      output += '\n';
    }
    output += '---\n\n';
  }

  saveOutput('02-live-threads.md', output);
  console.log('  ✓ Found engagement opportunities\n');
  return results;
}

// ─── STEP 3: Generate Launch Posts ───────────────────────────────────────────

async function generatePosts() {
  console.log('\n✍️  STEP 3: Generate Launch Posts');
  console.log('  Using sonar-pro to craft platform-specific content...\n');

  const platforms = [
    {
      name: 'hackernews',
      file: '03-hackernews-post.md',
      prompt: `Write a Hacker News "Show HN" post for ${PRODUCT.name}.

Product: ${PRODUCT.tagline}
npm: npx ${PRODUCT.npm} init
GitHub: ${PRODUCT.repo}
Pro Pack: ${PRODUCT.proPrice} on Gumroad

Requirements:
- Title must start with "Show HN:"
- Keep the post body under 300 words
- Focus on the technical innovation (Thompson Sampling for feedback routing, DPO/KTO export, prevention rules from repeated failures)
- Mention it works with Claude, Codex, Amp, Gemini
- No marketing fluff — HN readers want technical substance
- Include the npm install command
- End with a link to the repo

Also generate 3 alternative titles to A/B test.`,
    },
    {
      name: 'reddit',
      file: '03-reddit-post.md',
      prompt: `Write Reddit posts for ${PRODUCT.name} for these subreddits:
1. r/MachineLearning — focus on RLHF/DPO pipeline, academic angle
2. r/LocalLLaMA — focus on local-first, no cloud dependency
3. r/ClaudeAI — focus on Claude Code integration, MCP tools
4. r/programming — focus on the engineering of the feedback loop

Product: ${PRODUCT.tagline}
npm: npx ${PRODUCT.npm} init
GitHub: ${PRODUCT.repo}
Pro Pack: ${PRODUCT.proPrice} on Gumroad (${PRODUCT.gumroad})

For each subreddit, write:
- A title
- Post body (respect each subreddit's culture and rules)
- Suggested flair
Keep each post under 250 words. Be genuine, not salesy.`,
    },
    {
      name: 'devto',
      file: '03-devto-article.md',
      prompt: `Write a dev.to article for ${PRODUCT.name}.

Product: ${PRODUCT.tagline}
npm: npx ${PRODUCT.npm} init
GitHub: ${PRODUCT.repo}

Write a technical tutorial titled something like "How I Built a Self-Improving AI Agent Memory System" or "Teaching AI Agents to Learn from Their Mistakes with RLHF".

Requirements:
- dev.to frontmatter (title, published, description, tags, cover_image)
- 800-1200 words
- Include code snippets showing the MCP tool usage
- Explain the 5-phase pipeline: Capture → Validate → Remember → Prevent → Export
- Include the learning curve dashboard output
- End with links to GitHub, npm, and the Pro Pack
- Tags: ai, machinelearning, webdev, opensource`,
    },
    {
      name: 'twitter',
      file: '03-twitter-thread.md',
      prompt: `Write a Twitter/X thread (8-12 tweets) launching ${PRODUCT.name}.

Product: ${PRODUCT.tagline}
npm: npx ${PRODUCT.npm} init
GitHub: ${PRODUCT.repo}
Pro Pack: ${PRODUCT.proPrice} at ${PRODUCT.gumroad}

Requirements:
- First tweet must hook attention (problem statement)
- Use emojis sparingly but effectively
- Include a code snippet tweet showing the CLI
- Include the learning curve dashboard as a tweet
- One tweet about the Pro Pack value prop
- Last tweet: CTA to star the repo + link
- Each tweet under 280 chars
- Number each tweet (1/N format)`,
    },
    {
      name: 'linkedin',
      file: '03-linkedin-post.md',
      prompt: `Write a LinkedIn post announcing ${PRODUCT.name}.

Product: ${PRODUCT.tagline}
GitHub: ${PRODUCT.repo}

Requirements:
- Professional tone, not corporate bland
- Focus on the problem: AI agents repeat the same mistakes
- Position as an engineering innovation
- Mention it's open source (MIT)
- 150-250 words
- Include relevant hashtags
- End with a soft CTA`,
    },
    {
      name: 'producthunt',
      file: '03-producthunt-listing.md',
      prompt: `Write a Product Hunt listing for ${PRODUCT.name}.

Product: ${PRODUCT.tagline}
npm: npx ${PRODUCT.npm} init
GitHub: ${PRODUCT.repo}
Pro Pack: ${PRODUCT.proPrice} at ${PRODUCT.gumroad}

Requirements:
- Tagline (under 60 chars)
- Description (under 260 chars)
- Detailed description (300-500 words)
- 5 key features as bullet points
- "First comment" from the maker (personal story, why you built it)
- Suggested categories: Developer Tools, AI, Productivity
- Pricing: Free (open source) + Pro ($49 one-time)`,
    },
  ];

  const posts = [];

  for (const platform of platforms) {
    console.log(`  Generating ${platform.name} post...`);
    try {
      const result = await sonarRequest('sonar-pro', [
        {
          role: 'system',
          content: `You are an expert developer advocate and technical content creator. Write authentic, technically accurate content that resonates with developers. Never use generic marketing phrases. Be specific and genuine.`,
        },
        { role: 'user', content: platform.prompt },
      ], {
        web_search_options: { search_context_size: 'low' },
      });

      const content = result.choices[0].message.content;
      saveOutput(platform.file, `# ${platform.name.toUpperCase()} — Launch Post\n\nGenerated: ${new Date().toISOString()}\n\n${content}`);
      posts.push({ platform: platform.name, content });
    } catch (err) {
      console.log(`  ⚠ Failed: ${platform.name} — ${err.message}`);
    }
  }

  console.log('  ✓ All posts generated\n');
  return posts;
}

// ─── STEP 4: Generate SEO Content ────────────────────────────────────────────

async function generateSEO() {
  console.log('\n📈 STEP 4: SEO/GEO Optimization Content');
  console.log('  Generating content for AI search visibility...\n');

  const result = await sonarRequest('sonar-pro', [
    {
      role: 'system',
      content: 'You are an SEO expert specializing in developer tools and AI products. Focus on GEO (Generative Engine Optimization) — making content that AI search engines (Perplexity, Claude, ChatGPT) will cite.',
    },
    {
      role: 'user',
      content: `Generate SEO/GEO optimization content for ${PRODUCT.name}:

Product: ${PRODUCT.tagline}
URL: ${PRODUCT.repo}
npm: ${PRODUCT.npm}

Generate:
1. **FAQ Page Content** — 10 Q&As that match high-intent developer searches (format as JSON-LD FAQPage schema)
2. **Meta Descriptions** — for GitHub README, npm page, landing page
3. **Long-tail Keyword Targets** — 20 specific phrases developers search for
4. **Comparison Content** — "MCP Memory Gateway vs LangSmith", "MCP Memory Gateway vs custom RLHF", "MCP Memory Gateway vs Weights & Biases"
5. **Structured Data** — JSON-LD SoftwareApplication schema for the product

Make all content factually accurate and technically specific.`,
    },
  ], {
    web_search_options: { search_context_size: 'medium' },
  });

  const content = result.choices[0].message.content;
  saveOutput('04-seo-geo-content.md', `# SEO/GEO Optimization Content\n\nGenerated: ${new Date().toISOString()}\n\n${content}`);
  console.log('  ✓ SEO content generated\n');
  return content;
}

// ─── STEP 5: Generate Outreach Messages ──────────────────────────────────────

async function generateOutreach() {
  console.log('\n📧 STEP 5: Direct Outreach Templates');

  const result = await sonarRequest('sonar', [
    {
      role: 'system',
      content: 'You are a developer relations expert. Write concise, personalized outreach templates.',
    },
    {
      role: 'user',
      content: `Write outreach message templates for ${PRODUCT.name} (${PRODUCT.tagline}):

1. **Newsletter pitch** — for AI/ML newsletters (The Batch, TLDR AI, etc.)
2. **Podcast pitch** — for AI dev podcasts
3. **Influencer DM** — for AI Twitter/YouTube personalities
4. **Discord/Slack message** — for MCP/AI agent community channels
5. **Email to AI tool aggregator sites** — to get listed

Each should be under 150 words, personalized, and include ${PRODUCT.repo}
Include [PERSONALIZATION] placeholders.`,
    },
  ]);

  const content = result.choices[0].message.content;
  saveOutput('05-outreach-templates.md', `# Outreach Templates\n\nGenerated: ${new Date().toISOString()}\n\n${content}`);
  console.log('  ✓ Outreach templates generated\n');
  return content;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cmd = process.argv[2] || 'full';

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  Perplexity Max Marketing Engine                    ║');
  console.log('║  MCP Memory Gateway — First Dollar Campaign         ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  if (!API_KEY) {
    console.error('\n❌ PERPLEXITY_API_KEY not set.');
    console.error('   Add it to .env: PERPLEXITY_API_KEY=pplx-...');
    console.error('   Get your key: https://www.perplexity.ai/settings/api\n');
    process.exit(1);
  }

  console.log(`\nAPI Key: ${API_KEY.slice(0, 8)}...`);
  console.log(`Command: ${cmd}\n`);

  try {
    switch (cmd) {
    case 'research':
      await deepResearch();
      break;
    case 'find-threads':
      await findThreads();
      break;
    case 'generate':
      await generatePosts();
      break;
    case 'seo':
      await generateSEO();
      break;
    case 'outreach':
      await generateOutreach();
      break;
    case 'full':
      await deepResearch();
      await findThreads();
      await generatePosts();
      await generateSEO();
      await generateOutreach();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error('Commands: research, find-threads, generate, seo, outreach, full');
      process.exit(1);
    }

    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  ✅ Marketing content generated!                    ║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║  Output: ${OUTPUT_DIR}`);
    console.log('║                                                      ║');
    console.log('║  Next steps:                                         ║');
    console.log('║  1. Review generated content in artifacts/marketing  ║');
    console.log('║  2. Post to platforms (HN, Reddit, dev.to, Twitter)  ║');
    console.log('║  3. Send outreach messages                           ║');
    console.log('║  4. Update landing page with SEO content             ║');
    console.log('╚══════════════════════════════════════════════════════╝');

  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
