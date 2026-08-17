/**
 * @fileoverview TypeScript 7.0 Readiness Verification Test
 * Validates that ThumbGate workers are compatible with TypeScript 7.0+
 * 
 * @see TYPESCRIPT_7_READINESS.md for detailed documentation
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKERS_DIR = resolve(__dirname, '../workers');

test('TypeScript 7.0 is installed in workers', () => {
  const packageJsonPath = resolve(WORKERS_DIR, 'package.json');
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  
  assert.ok(pkg.devDependencies.typescript, 'TypeScript should be in devDependencies');
  assert.ok(pkg.devDependencies.typescript.startsWith('^7.'), 
    `TypeScript version should be 7.x, got: ${pkg.devDependencies.typescript}`);
});

test('Workers tsconfig.json is TS7-compatible', () => {
  const tsconfigPath = resolve(WORKERS_DIR, 'tsconfig.json');
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
  
  const requiredSettings = {
    'esModuleInterop': true,
    'alwaysStrict': true,
    'noUncheckedSideEffectImports': true,
    'rootDir': './src'
  };
  
  for (const [key, expectedValue] of Object.entries(requiredSettings)) {
    assert.deepEqual(tsconfig.compilerOptions[key], expectedValue,
      `compilerOptions.${key} should be ${expectedValue}`);
  }
  
  // Verify target is ES2022 (compatible)
  assert.equal(tsconfig.compilerOptions.target, 'ES2022',
    'Target should be ES2022 for modern environments');
});

test('TypeScript type-check passes on workers', () => {
  let output;
  let error = null;
  
  try {
    output = execSync('npx tsc --version', {
      cwd: WORKERS_DIR,
      encoding: 'utf8'
    });
  } catch (e) {
    error = e;
  }
  
  assert.equal(error, null, `TypeScript should be executable: ${error?.message}`);
  assert.ok(output.includes('Version 7.'), 
    `Should be TypeScript 7.x, got: ${output}`);
});

test('Workers package-lock.json reflects TypeScript 7', () => {
  const lockPath = resolve(WORKERS_DIR, 'package-lock.json');
  const lockContent = readFileSync(lockPath, 'utf8');
  
  assert.ok(lockContent.includes('"typescript":'), 
    'package-lock.json should reference typescript');
  assert.ok(lockContent.includes('7.0.2') || lockContent.includes('"version": "7.'), 
    'package-lock.json should reference TypeScript 7.x');
});

test('Workers directory structure is valid', () => {
  const srcDir = resolve(WORKERS_DIR, 'src');
  assert.ok(existsSync(srcDir), 'Workers src directory should exist');
  
  // Check for TypeScript files
  const files = readdirSync(srcDir, { withFileTypes: true });
  const tsFiles = files.filter(f => f.isFile() && f.name.endsWith('.ts'));
  
  assert.ok(tsFiles.length > 0, 'Should have TypeScript source files in workers/src');
});