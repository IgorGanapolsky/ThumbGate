'use strict';

const fs = require('fs');
const path = require('path');
const { wiringReport } = require('../scripts/mcp-wiring-doctor');
const { getFeedbackPaths } = require('../scripts/feedback-paths');

const AXES = [
  { id: 'design', name: 'Design', meaning: 'Interfaces wired (MCP / hooks)' },
  { id: 'implement', name: 'Implement', meaning: 'Lessons store writable' },
  { id: 'data', name: 'Data', meaning: 'Feedback rows captured' },
  { id: 'promote', name: 'Promote', meaning: 'Prevention rules exist' },
  { id: 'evaluate', name: 'Evaluate', meaning: 'Local summary or stats exist' },
  { id: 'deploy', name: 'Deploy', meaning: 'Dashboard or proof surface present' },
];

function countJsonlLines(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return 0;
    return fs.readFileSync(filePath, 'utf8').split('\n').filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}

function fileNonEmpty(filePath) {
  try {
    return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).size > 0);
  } catch {
    return false;
  }
}

function getPipelineCompass(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const env = options.env || process.env;
  const wiring = wiringReport(projectRoot, env);
  const paths = getFeedbackPaths({
    projectDir: projectRoot,
    env,
    feedbackDir: options.feedbackDir,
  });

  const feedbackRows = countJsonlLines(paths.FEEDBACK_LOG_PATH);
  const memoryRows = countJsonlLines(paths.MEMORY_LOG_PATH);
  const hasRules = fileNonEmpty(paths.PREVENTION_RULES_PATH);
  const hasSummary = fileNonEmpty(paths.SUMMARY_PATH);
  const dashboardHtml = path.join(projectRoot, 'public', 'dashboard.html');
  const localDashboard = fileNonEmpty(dashboardHtml)
    || fs.existsSync(path.join(projectRoot, 'bin', 'dashboard-cli.js'));

  const axes = {
    design: wiring.overall !== 'error',
    implement: Boolean(wiring.lessonsStore && wiring.lessonsStore.writable)
      || fileNonEmpty(paths.FEEDBACK_DIR && path.join(paths.FEEDBACK_DIR, '.keep'))
      || fs.existsSync(paths.FEEDBACK_DIR),
    data: feedbackRows > 0,
    promote: hasRules || memoryRows > 0,
    evaluate: hasSummary || feedbackRows > 0,
    deploy: localDashboard || wiring.overall === 'ok',
  };

  const scores = AXES.map((axis) => ({
    ...axis,
    pass: Boolean(axes[axis.id]),
  }));
  const passed = scores.filter((axis) => axis.pass).length;

  return {
    motto: 'Pipeline first, algorithms second.',
    source: 'TradeMaster-style 6-module loop mapped onto existing ThumbGate surfaces. Not an RL trading platform.',
    projectRoot,
    wiring: wiring.overall,
    feedbackRows,
    memoryRows,
    axes: scores,
    passed,
    total: AXES.length,
    ready: wiring.overall !== 'error' && axes.design,
  };
}

function formatPipelineCompass(report) {
  const lines = [
    `ThumbGate pipeline compass (${report.passed}/${report.total})`,
    report.motto,
    '',
  ];
  for (const axis of report.axes) {
    lines.push(`${axis.pass ? '✓' : '·'} ${axis.name.padEnd(10)} ${axis.meaning}`);
  }
  lines.push('');
  lines.push(`Feedback rows: ${report.feedbackRows}  Memory rows: ${report.memoryRows}  Wiring: ${report.wiring}`);
  if (!report.ready) {
    lines.push('Next: npx thumbgate init && npx thumbgate doctor  (pipeline before more gates)');
  }
  return lines.join('\n');
}

module.exports = {
  AXES,
  getPipelineCompass,
  formatPipelineCompass,
};
