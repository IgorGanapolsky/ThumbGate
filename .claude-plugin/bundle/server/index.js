#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawn } = require('child_process');

// __dirname is <bundle>/server; bin/cli.js is ONE level up, inside the bundle.
// A second '..' escapes the bundle entirely — installed under Claude Desktop this
// resolved to "Claude Extensions/bin/cli.js", which does not exist, so the server
// crashed on launch and Desktop showed "Server disconnected" with no other clue.
const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
const child = spawn(process.execPath, [cliPath, 'serve'], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(`[thumbgate] Failed to launch Claude Desktop bundle runtime: ${error.message}`);
  process.exit(1);
});
