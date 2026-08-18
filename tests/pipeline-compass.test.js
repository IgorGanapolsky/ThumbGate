'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getPipelineCompass, formatPipelineCompass, AXES } = require('../src/pipeline-compass');

test('compass has six named axes and refuses trading claims', () => {
  assert.equal(AXES.length, 6);
  const report = getPipelineCompass({ projectRoot: path.join(__dirname, '..') });
  assert.equal(report.axes.length, 6);
  assert.match(report.motto, /Pipeline first/);
  assert.match(report.source, /Not an RL trading platform/);
  assert.doesNotMatch(formatPipelineCompass(report), /Sharpe|portfolio/i);
});

test('empty project is not ready until wired', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-compass-'));
  const report = getPipelineCompass({
    projectRoot: dir,
    feedbackDir: path.join(dir, 'feedback'),
    env: { ...process.env, THUMBGATE_FEEDBACK_DIR: path.join(dir, 'feedback') },
  });
  assert.equal(report.ready, false);
  assert.equal(report.feedbackRows, 0);
  assert.equal(report.axes.find((axis) => axis.id === 'data').pass, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('feedback rows light the data axis', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-compass-data-'));
  const feedbackDir = path.join(dir, 'feedback');
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.writeFileSync(path.join(feedbackDir, 'feedback-log.jsonl'), '{"id":"1"}\n');
  const report = getPipelineCompass({
    projectRoot: dir,
    feedbackDir,
    env: { ...process.env, THUMBGATE_FEEDBACK_DIR: feedbackDir },
  });
  assert.equal(report.feedbackRows, 1);
  assert.equal(report.axes.find((axis) => axis.id === 'data').pass, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
