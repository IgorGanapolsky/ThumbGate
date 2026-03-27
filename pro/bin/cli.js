#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const PRO_API = 'https://rlhf-feedback-loop-production.up.railway.app';
const LICENSE_DIR = path.join(os.homedir(), '.thumbgate');
const LICENSE_PATH = path.join(LICENSE_DIR, 'license.json');

function readLicense() {
  try {
    return JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveLicense(key) {
  if (!fs.existsSync(LICENSE_DIR)) fs.mkdirSync(LICENSE_DIR, { recursive: true });
  fs.writeFileSync(LICENSE_PATH, JSON.stringify({ key, savedAt: new Date().toISOString() }, null, 2) + '\n');
}

async function validateKey(key) {
  try {
    const res = await fetch(`${PRO_API}/v1/billing/usage`, {
      headers: { 'Authorization': `Bearer ${key}` },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.key);
  } catch {
    return false;
  }
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  let license = readLicense();

  if (!license || !license.key) {
    console.log('\n👍👎 ThumbGate Pro — License Activation');
    console.log('─'.repeat(45));
    console.log('Enter the license key from your purchase email.');
    console.log(`(Buy Pro: ${PRO_API})\n`);
    const key = await prompt('License key: ');
    if (!key) {
      console.error('No key provided. Exiting.');
      process.exit(1);
    }

    process.stderr.write('Validating... ');
    const valid = await validateKey(key);
    if (!valid) {
      console.error('✗ Invalid key. Check your purchase email or buy Pro at:');
      console.error(`  ${PRO_API}\n`);
      process.exit(1);
    }

    saveLicense(key);
    console.error('✓ Licensed! Key saved to ~/.thumbgate/license.json\n');
    license = { key };
  }

  // Start server with Pro mode
  process.env.RLHF_PRO_MODE = '1';
  process.env.RLHF_API_KEY = license.key;
  const PORT = process.env.PORT || 3456;
  process.env.PORT = String(PORT);

  const parentPkg = path.resolve(__dirname, '..', '..');
  const { startServer } = require(path.join(parentPkg, 'src', 'api', 'server.js'));

  const { port } = await startServer({ port: Number(PORT) });
  console.log(`👍👎 ThumbGate Pro dashboard: http://localhost:${port}/dashboard\n`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
