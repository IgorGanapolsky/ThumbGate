const fs = require('fs');
const path = './package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));

if (!pkg.files.includes('src/session-interactivity.js')) {
  pkg.files.push('src/session-interactivity.js');
  pkg.files.sort();
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  console.log('Added src/session-interactivity.js to package.json files array.');
}
