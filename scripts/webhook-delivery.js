#!/usr/bin/env node
'use strict';

const https = require('https');
const http = require('http');

function sendWebhook(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    const mod = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);
    
    const req = mod.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Webhook timeout')); });
    req.write(body);
    req.end();
  });
}

async function deliverToTeams(webhookUrl, title, message) {
  return sendWebhook(webhookUrl, {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    summary: title,
    themeColor: '0076D7',
    title,
    text: message,
  });
}

async function deliverToSlack(webhookUrl, title, message) {
  return sendWebhook(webhookUrl, {
    text: `*${title}*\n${message}`,
  });
}

async function deliverToDiscord(webhookUrl, title, message) {
  return sendWebhook(webhookUrl, {
    embeds: [{ title, description: message.substring(0, 4096), color: 0x0076D7 }],
  });
}

async function deliver(platform, webhookUrl, title, message) {
  switch (platform) {
    case 'teams': return deliverToTeams(webhookUrl, title, message);
    case 'slack': return deliverToSlack(webhookUrl, title, message);
    case 'discord': return deliverToDiscord(webhookUrl, title, message);
    default: return sendWebhook(webhookUrl, { title, message });
  }
}

module.exports = { deliver, deliverToTeams, deliverToSlack, deliverToDiscord, sendWebhook };
