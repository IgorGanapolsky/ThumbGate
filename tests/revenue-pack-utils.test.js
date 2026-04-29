'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeRevenuePackArtifacts } = require('../scripts/revenue-pack-utils');

test('writeRevenuePackArtifacts writes markdown sidecars alongside docs when writeDocs is enabled', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-revenue-pack-utils-'));
  const docsPath = path.join(repoRoot, 'docs', 'marketing', 'sample-pack.md');

  try {
    const written = writeRevenuePackArtifacts({
      repoRoot,
      writeDocs: true,
      docsPath,
      markdown: '# Sample Pack\n',
      jsonName: 'sample-pack.json',
      jsonValue: { state: 'ok' },
      csvArtifacts: [
        {
          name: 'sample-pack.csv',
          value: 'key,value\nstate,ok\n',
        },
      ],
    });

    assert.equal(written.docsPath, docsPath);
    assert.equal(fs.readFileSync(docsPath, 'utf8'), '# Sample Pack\n');
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs', 'marketing', 'sample-pack.json'), 'utf8')),
      { state: 'ok' },
    );
    assert.equal(
      fs.readFileSync(path.join(repoRoot, 'docs', 'marketing', 'sample-pack.csv'), 'utf8'),
      'key,value\nstate,ok\n',
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('writeRevenuePackArtifacts uses csvName fallback when csvArtifacts are omitted', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-revenue-pack-utils-'));
  const docsPath = path.join(repoRoot, 'docs', 'marketing', 'fallback-pack.md');

  try {
    writeRevenuePackArtifacts({
      repoRoot,
      writeDocs: true,
      docsPath,
      markdown: '# Fallback Pack\n',
      csvName: 'fallback-pack.csv',
      csvValue: 'key,value\nstate,fallback\n',
    });

    assert.equal(
      fs.readFileSync(path.join(repoRoot, 'docs', 'marketing', 'fallback-pack.csv'), 'utf8'),
      'key,value\nstate,fallback\n',
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
