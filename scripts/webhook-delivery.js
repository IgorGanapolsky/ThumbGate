#!/usr/bin/env node
'use strict';

const https = require('https');
const http = require('http');
const { idempotencyKey, runStep } = require('./durability/step');

function sendWebhookOnce(webhookUrl, payload, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    const mod = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);

    const req = mod.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Idempotency-Key': options.idempotencyKey,
      },
      timeout: options.timeoutMs || 10000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        const status = Number(res.statusCode || 0);
        if (status >= 200 && status < 300) {
          resolve({ status, body: data });
          return;
        }
        const error = new Error(`Webhook delivery failed with HTTP ${status}`);
        error.status = status;
        error.responseBody = data;
        error.headers = res.headers || {};
        reject(error);
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      const error = new Error('Webhook timeout');
      error.code = 'ETIMEDOUT';
      reject(error);
    });
    req.write(body);
    req.end();
  });
}

function sendWebhook(webhookUrl, payload, options = {}) {
  const key = options.idempotencyKey || idempotencyKey('webhook', webhookUrl, payload);
  return runStep('webhook.delivery', {
    retries: options.retries ?? 2,
    backoffMs: options.backoffMs,
    sleepFn: options.sleepFn,
    maxElapsedMs: options.maxElapsedMs ?? 15000,
    jitterRatio: options.jitterRatio ?? 0.1,
    randomFn: options.randomFn,
    sideEffect: true,
    idempotencyKey: key,
  }, ({ idempotencyKey: stableKey }) => sendWebhookOnce(webhookUrl, payload, {
    ...options,
    idempotencyKey: stableKey,
  }));
}

async function deliverToTeams(webhookUrl, title, message, options) {
  return sendWebhook(webhookUrl, {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    summary: title,
    themeColor: '0076D7',
    title,
    text: message,
  }, options);
}

async function deliverToSlack(webhookUrl, title, message, options) {
  return sendWebhook(webhookUrl, {
    text: `*${title}*\n${message}`,
  }, options);
}

async function deliverToDiscord(webhookUrl, title, message, options) {
  return sendWebhook(webhookUrl, {
    embeds: [{ title, description: message.substring(0, 4096), color: 0x0076D7 }],
  }, options);
}

async function deliver(platform, webhookUrl, title, message, options) {
  switch (platform) {
    case 'teams': return deliverToTeams(webhookUrl, title, message, options);
    case 'slack': return deliverToSlack(webhookUrl, title, message, options);
    case 'discord': return deliverToDiscord(webhookUrl, title, message, options);
    default: return sendWebhook(webhookUrl, { title, message }, options);
  }
}

module.exports = {
  deliver,
  deliverToTeams,
  deliverToSlack,
  deliverToDiscord,
  sendWebhook,
  sendWebhookOnce,
};
