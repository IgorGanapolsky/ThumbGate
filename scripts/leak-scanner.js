#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const TARGETS = [
  'https://www.luzaka.com',
  'https://www.parissima.com',
  'https://boutique-artisans-du-monde.com',
  'https://eclatparis.com',
  'https://aliexfantaisies.com'
];

async function checkRedirect(url) {
  const result = {
    startUrl: url,
    chain: [],
    finalUrl: url,
    status: null,
    error: null,
    httpsReady: false,
    wwwConsistent: false,
  };

  try {
    let currentUrl = url;
    let redirectsCount = 0;
    const maxRedirects = 5;

    while (redirectsCount < maxRedirects) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      });
      clearTimeout(id);

      result.status = res.status;
      result.chain.push({ url: currentUrl, status: res.status });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          break;
        }
        
        // Resolve relative redirects
        let nextUrl = location;
        if (location.startsWith('/')) {
          const parsed = new URL(currentUrl);
          nextUrl = `${parsed.protocol}//${parsed.host}${location}`;
        } else if (!location.startsWith('http')) {
          const parsed = new URL(currentUrl);
          nextUrl = `${parsed.protocol}//${parsed.host}/${location}`;
        }

        if (nextUrl === currentUrl) {
          result.error = 'Redirect loop detected';
          break;
        }

        currentUrl = nextUrl;
        redirectsCount++;
      } else {
        break;
      }
    }

    result.finalUrl = currentUrl;
    
    // Check SSL/HTTPS correctness
    if (result.finalUrl.startsWith('https://')) {
      result.httpsReady = true;
    }
    
    // Check if www redirect matches
    const startUrlParsed = new URL(url);
    const finalUrlParsed = new URL(result.finalUrl);
    if (startUrlParsed.hostname.startsWith('www.') === finalUrlParsed.hostname.startsWith('www.')) {
      result.wwwConsistent = true;
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

async function fetchPage(url) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: controller.signal
    });
    clearTimeout(id);
    if (!res.ok) {
      return { status: res.status, content: null, error: `HTTP error: ${res.status}` };
    }
    const html = await res.text();
    return { status: res.status, content: html, error: null };
  } catch (err) {
    return { status: null, content: null, error: err.message };
  }
}

async function checkSitemap(domain) {
  const candidates = [
    `https://${domain}/sitemap.xml`,
    `https://${domain}/sitemap_index.xml`,
    `https://www.${domain}/sitemap.xml`,
    `https://www.${domain}/sitemap_index.xml`,
  ];

  // Try robots.txt first
  try {
    const robotsRes = await fetchPage(`https://${domain}/robots.txt`);
    if (robotsRes.content) {
      const match = robotsRes.content.match(/sitemap:\s*(https?:\/\/\S+)/i);
      if (match && match[1]) {
        candidates.unshift(match[1]);
      }
    }
  } catch (e) {
    // Ignore robots errors
  }

  for (const url of candidates) {
    const res = await fetchPage(url);
    if (res.content && (res.content.includes('<url>') || res.content.includes('<sitemap>'))) {
      // Parse URLs from sitemap
      const urls = [];
      const urlRegex = /<loc>(https?:\/\/[^<]+)<\/loc>/g;
      let match;
      while ((match = urlRegex.exec(res.content)) !== null) {
        urls.push(match[1]);
        if (urls.length >= 10) break; // Limit to 10 for analysis
      }
      return {
        found: true,
        sitemapUrl: url,
        urlCount: urls.length,
        sampleUrls: urls
      };
    }
  }

  return { found: false, sitemapUrl: null, urlCount: 0, sampleUrls: [] };
}

async function checkStripeLeak(html) {
  if (!html) return { hasStripe: false, leaks: [] };

  const indicators = [];
  const leaks = [];

  if (html.includes('js.stripe.com')) {
    indicators.push('Stripe.js library loaded');
  }
  if (html.includes('Stripe(')) {
    indicators.push('Stripe instantiation found');
  }
  if (html.includes('pk_live_')) {
    const keyMatch = html.match(/pk_live_[a-zA-Z0-9]+/);
    if (keyMatch) {
      indicators.push(`Live publishable key found: ${keyMatch[0].substring(0, 15)}...`);
    }
  }
  if (html.includes('pk_test_')) {
    const keyMatch = html.match(/pk_test_[a-zA-Z0-9]+/);
    if (keyMatch) {
      leaks.push(`Exposed test Stripe key: ${keyMatch[0]}`);
    }
  }

  // Check for common client-side leaks or configurations
  if (html.includes('sk_live_') || html.includes('sk_test_')) {
    leaks.push('CRITICAL: Stripe secret key exposed in client-side HTML!');
  }

  return {
    hasStripe: indicators.length > 0 || leaks.length > 0,
    indicators,
    leaks
  };
}

async function scanTarget(targetUrl) {
  const urlObj = new URL(targetUrl);
  const domain = urlObj.hostname.replace('www.', '');

  console.log(`Scanning ${domain}...`);

  // 1. Check redirects
  const httpToHttps = await checkRedirect(`http://${domain}`);
  const nonWwwToWww = await checkRedirect(`https://${domain}`);
  const finalUrlCheck = await checkRedirect(targetUrl);

  // 2. Check sitemap
  const sitemapResult = await checkSitemap(domain);

  // 3. Fetch home page and check for Stripe
  const homePage = await fetchPage(targetUrl);
  const stripeResult = await checkStripeLeak(homePage.content);

  // 4. Check for sitemap URL redirects
  const sitemapUrlsChecked = [];
  if (sitemapResult.found && sitemapResult.sampleUrls.length > 0) {
    for (const sampleUrl of sitemapResult.sampleUrls.slice(0, 3)) {
      const check = await checkRedirect(sampleUrl);
      sitemapUrlsChecked.push({
        url: sampleUrl,
        status: check.status,
        finalUrl: check.finalUrl,
        redirected: sampleUrl !== check.finalUrl
      });
    }
  }

  // Deduce leaks and vulnerabilities
  const anomalies = [];
  if (!httpToHttps.httpsReady || httpToHttps.status !== 200) {
    anomalies.push('Insecure HTTP entrypoint: HTTP requests do not redirect cleanly to HTTPS');
  }
  if (nonWwwToWww.error) {
    anomalies.push(`Root domain redirect error: ${nonWwwToWww.error}`);
  }
  if (!sitemapResult.found) {
    anomalies.push('Missing sitemap: no sitemap.xml found in robots.txt or standard paths');
  }
  if (stripeResult.leaks.length > 0) {
    anomalies.push(...stripeResult.leaks);
  }

  return {
    domain,
    targetUrl,
    redirects: {
      httpToHttps,
      nonWwwToWww,
      finalUrlCheck
    },
    sitemap: sitemapResult,
    stripe: stripeResult,
    sitemapUrlsChecked,
    anomalies,
    pageFetchedSuccessfully: !!homePage.content,
    fetchError: homePage.error
  };
}

async function run() {
  console.log('Starting ThumbGate Sitemap & Redirect Leak Scan...');
  console.log(`Scan Date: ${new Date().toISOString().split('T')[0]}`);
  
  let targets = TARGETS;
  const fileArgIndex = process.argv.indexOf('--file');
  if (fileArgIndex > -1 && process.argv[fileArgIndex + 1]) {
    const filePath = path.resolve(process.argv[fileArgIndex + 1]);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      targets = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
      targets = targets.map(t => t.startsWith('http') ? t : `https://${t}`);
    } else {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
  }

  const concurrencyArgIndex = process.argv.indexOf('--concurrency');
  let concurrencyLimit = 10;
  if (concurrencyArgIndex > -1 && process.argv[concurrencyArgIndex + 1]) {
    concurrencyLimit = parseInt(process.argv[concurrencyArgIndex + 1], 10) || 10;
  }

  console.log('Targets Count:', targets.length);
  console.log('Concurrency Limit:', concurrencyLimit);
  console.log('--------------------------------------------------');

  const results = [];
  for (let i = 0; i < targets.length; i += concurrencyLimit) {
    const chunk = targets.slice(i, i + concurrencyLimit);
    const promises = chunk.map(async (target) => {
      try {
        return await scanTarget(target);
      } catch (err) {
        console.error(`Error scanning ${target}:`, err);
        return {
          targetUrl: target,
          domain: new URL(target).hostname,
          error: err.message,
          anomalies: [`Scan execution failed: ${err.message}`]
        };
      }
    });
    const chunkResults = await Promise.all(promises);
    results.push(...chunkResults);
  }

  // Write results to JSON
  const outputDir = path.join(__dirname, '..', 'reports', 'scans');
  fs.mkdirSync(outputDir, { recursive: true });
  
  const reportPathJson = path.join(outputDir, `scan_report_${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(reportPathJson, JSON.stringify(results, null, 2) + '\n');
  console.log(`Saved JSON report to ${reportPathJson}`);

  // Write markdown report
  const reportPathMd = path.join(outputDir, `scan_report_${new Date().toISOString().split('T')[0]}.md`);
  let md = `# ThumbGate Sitemap & Redirect Leak Scan Report\n\n`;
  md += `**Date:** ${new Date().toISOString().split('T')[0]}\n`;
  md += `**Objective:** Scan the pilot French e-commerce websites for sitemap discoverability, redirect loops, SSL consistency, and Stripe/checkout leaks.\n\n`;

  md += `## Executive Summary\n\n`;
  let totalAnomalies = 0;
  results.forEach(r => {
    totalAnomalies += (r.anomalies || []).length;
  });
  
  md += `- **Total Sites Scanned:** ${results.length}\n`;
  md += `- **Sites with Anomalies/Leaks:** ${results.filter(r => (r.anomalies || []).length > 0).length}\n`;
  md += `- **Total Anomalies Detected:** ${totalAnomalies}\n\n`;
  md += `### Quick Dashboard\n\n`;
  md += `| Domain | Page Fetch | Sitemap | Stripe Found | Redirect Issues | Leaks/Anomalies | Status |\n`;
  md += `| --- | --- | --- | --- | --- | --- | --- |\n`;

  results.forEach(r => {
    const fetchStatus = r.pageFetchedSuccessfully ? '✅ OK' : '❌ Fail';
    const sitemapStatus = r.sitemap?.found ? `✅ Found (${r.sitemap.urlCount})` : '❌ Missing';
    const stripeStatus = r.stripe?.hasStripe ? 'Yes' : 'No';
    const redirectStatus = (r.anomalies || []).some(a => a.toLowerCase().includes('redirect')) ? '⚠️ Issues' : '✅ Clean';
    const anomalyCount = (r.anomalies || []).length;
    const finalStatus = anomalyCount > 0 ? '🔴 Needs Patch' : '🟢 Healthy';

    md += `| ${r.domain} | ${fetchStatus} | ${sitemapStatus} | ${stripeStatus} | ${redirectStatus} | ${anomalyCount} | ${finalStatus} |\n`;
  });

  md += `\n---\n\n## Detailed Findings by Site\n\n`;

  results.forEach(r => {
    md += `### 1. ${r.domain}\n\n`;
    md += `- **Target URL:** ${r.targetUrl}\n`;
    if (r.error) {
      md += `  - **Error during scan:** \`${r.error}\`\n\n`;
      return;
    }
    md += `- **Page Load:** ${r.pageFetchedSuccessfully ? 'Successful' : `Failed (${r.fetchError})`}\n`;
    md += `- **Sitemap:** ${r.sitemap.found ? `Found at \`${r.sitemap.sitemapUrl}\` with ${r.sitemap.urlCount} URLs` : 'Not found in default paths or robots.txt'}\n`;
    md += `- **Stripe Integration:** ${r.stripe.hasStripe ? 'Detected' : 'Not detected on homepage'}\n`;
    if (r.stripe.hasStripe) {
      md += `  - *Indicators:* ${r.stripe.indicators.join(', ')}\n`;
    }
    md += `\n#### Redirect Chains\n\n`;
    md += `- **HTTP to HTTPS redirect:** \`http://${r.domain}\` status \`${r.redirects.httpToHttps.status}\`\n`;
    if (r.redirects.httpToHttps.chain.length > 0) {
      md += `  - Chain: ` + r.redirects.httpToHttps.chain.map(c => `\`${c.url}\` (${c.status})`).join(' ➔ ') + '\n';
    }
    md += `- **Non-WWW to WWW redirect:** \`https://${r.domain}\` status \`${r.redirects.nonWwwToWww.status}\`\n`;
    if (r.redirects.nonWwwToWww.chain.length > 0) {
      md += `  - Chain: ` + r.redirects.nonWwwToWww.chain.map(c => `\`${c.url}\` (${c.status})`).join(' ➔ ') + '\n';
    }

    if (r.sitemapUrlsChecked.length > 0) {
      md += `\n#### Sitemap URL Verification (Sample Checks)\n\n`;
      r.sitemapUrlsChecked.forEach(chk => {
        md += `  - \`${chk.url}\` ➔ ${chk.redirected ? `Redirected to \`${chk.finalUrl}\` (Status: ${chk.status})` : `Direct resolve (Status: ${chk.status})`}\n`;
      });
    }

    md += `\n#### Detected Anomalies & Leaks\n\n`;
    if (r.anomalies.length === 0) {
      md += `*No leaks or redirect anomalies detected.*\n\n`;
    } else {
      r.anomalies.forEach(a => {
        md += `- **[LEAK]** ${a}\n`;
      });
      md += '\n';
    }
  });

  fs.writeFileSync(reportPathMd, md + '\n');
  console.log(`Saved Markdown report to ${reportPathMd}`);
}

run().catch(console.error);
