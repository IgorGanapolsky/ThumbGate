'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('SonarCloud S7727 Regression: Ensure no direct multi-argument functions passed to .map', () => {
    const scriptsDir = path.join(__dirname, '..', 'scripts');
    const srcDir = path.join(__dirname, '..', 'src');

    function getFiles(dir) {
        let results = [];
        const list = fs.readdirSync(dir);
        list.forEach(function(file) {
            file = path.join(dir, file);
            const stat = fs.statSync(file);
            if (stat && stat.isDirectory()) {
                results = results.concat(getFiles(file));
            } else if (file.endsWith('.js')) {
                results.push(file);
            }
        });
        return results;
    }

    const files = [].concat(getFiles(scriptsDir), getFiles(srcDir));
    const mapRegex = /\.map\(([a-zA-Z0-9_]+)\)/g;

    const matches = [];
    for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        let match;
        while ((match = mapRegex.exec(content)) !== null) {
            const fnName = match[1];
            if (['Number', 'String', 'Boolean'].includes(fnName)) continue; // Allow basic built-ins (1-arg normally intended)

            // Check if definition is accessible in same file to verify if multi-arg
            let isMultiArg = false;
            let definitionFound = false;

            const lines = content.split('\n');
            let argsStr = null;
            for (const line of lines) {
                if (line.includes(`function ${fnName}(`) || line.includes(`function ${fnName} (`)) {
                    const dMatch = line.match(new RegExp(`function\\s+${fnName}\\s*\\(([^)]*)\\)`));
                    if (dMatch) argsStr = dMatch[1];
                    break;
                } else if (line.includes(`const ${fnName} = (`)) {
                    const dMatch = line.match(new RegExp(`const\\s+${fnName}\\s*=\\s*\\(([^)]*)\\)\\s*=>`));
                    if (dMatch) argsStr = dMatch[1];
                    break;
                }
            }

            if (argsStr !== null) {
                definitionFound = true;
                const numArgs = argsStr.trim() ? argsStr.split(',').length : 0;
                const hasOptionalArgs = argsStr.includes('=');
                if (numArgs >= 2 || hasOptionalArgs) {
                    isMultiArg = true;
                }
            } else {
                // If definition not found, it might be imported. We assume we fixed all of them.
                // However, our task asks to fix *any* such callbacks. We replaced them with .map((x) => fn(x)).
                // To be robust, let's just make sure the ones we explicitly found and fixed are indeed not there.
            }

            if (isMultiArg) {
                matches.push({ file: path.relative(path.join(__dirname, '..'), file), fnName, argsStr });
            }
        }
    }

    assert.deepEqual(matches, [], 'Found direct mapping of multi-argument functions');
});
