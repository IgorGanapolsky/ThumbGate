// Infinite Autonomy Loop: PRs, Rules, Heal, Revenue
const { execSync } = require('child_process');

setInterval(() => {
  try {
    execSync('npm run pr:manage', { cwd: __dirname, stdio: 'ignore' });
    execSync('npm run feedback:rules:llm', { cwd: __dirname, stdio: 'ignore' });
    execSync('npm run self-heal:run', { cwd: __dirname, stdio: 'ignore' });
    execSync('npm run revenue:status:local', { cwd: __dirname, stdio: 'ignore' });
  } catch {}
}, 300000); // 5min

console.log('ThumbGate Autonomy Loop: Running forever...');