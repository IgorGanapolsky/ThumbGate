#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawn } = require('child_process');

const cliPath = path.join(__dirname, '..', '..', 'bin', 'cli.js');
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
