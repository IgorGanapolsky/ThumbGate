// ThumbGate Daemon: Zero-Touch Autonomy
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const PID_FILE = path.join(ROOT, '.thumbgate/daemon.pid');
const LOG_FILE = path.join(ROOT, '.thumbgate/daemon.log');

function start() {
  if (fs.existsSync(PID_FILE)) {
    console.log('Daemon already running');
    return;
  }
  const pid = spawn('node', [path.join(ROOT, 'scripts/autonomy-loop.js')], { 
    stdio: 'pipe',
    detached: true 
  }).pid;
  fs.writeFileSync(PID_FILE, pid.toString());
  console.log(`Daemon started (PID: ${pid})`);
}

function stop() {
  if (!fs.existsSync(PID_FILE)) return;
  const pid = fs.readFileSync(PID_FILE, 'utf8').trim();
  process.kill(pid, 'SIGTERM');
  fs.unlinkSync(PID_FILE);
  console.log('Daemon stopped');
}

if (process.argv[2] === 'start') start();
if (process.argv[2] === 'stop') stop();