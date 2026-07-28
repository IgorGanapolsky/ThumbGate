#!/usr/bin/env node
'use strict';

/**
 * eval-risk-model.js — repeated-resampling evaluation of the learned risk model.
 *
 * WHY A HARNESS AND NOT A ONE-OFF SCRIPT
 *
 * The first held-out measurement of this model returned +0.022 lift. The second, on a
 * different split of the same corpus, returned -0.083. Both were "the" held-out number. A
 * single split of a few hundred rows has a standard deviation large enough to swamp the effect
 * being measured, so any decision made from one split is a coin flip wearing a lab coat.
 *
 * This runs N independent splits and reports mean ± sd, so a claim about model quality comes
 * with the spread that makes it checkable. It also reports the paired comparison between
 * configurations, because "config A scored higher once" is not evidence and a paired t over
 * shared splits is.
 *
 *   node scripts/eval-risk-model.js                     # evaluate the local corpus
 *   node scripts/eval-risk-model.js --resamples 20      # more splits, tighter intervals
 *   node scripts/eval-risk-model.js --json              # machine-readable
 *   node scripts/eval-risk-model.js --compare-caps      # is the diversity cap worth it?
 *
 * Exit codes: 0 evaluated, 2 no corpus / not enough data to evaluate.
 */

const fs = require('node:fs');
const riskScorer = require('./risk-scorer.js');

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/** Population standard deviation — for describing a set of observed resample scores. */
function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

/**
 * Sample standard deviation (n-1). The paired t statistic requires this, not the population
 * form: dividing by n understates the spread and inflates t, which can push a configuration
 * sitting near the significance boundary onto the wrong side of it.
 */
function sampleStandardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  const sumSquares = values.reduce((sum, value) => sum + ((value - average) ** 2), 0);
  return Math.sqrt(sumSquares / (values.length - 1));
}

/**
 * Paired t statistic over shared splits.
 *
 * Paired, not independent: both configurations are measured on the SAME folds, so the
 * fold-to-fold variance (which is large) cancels and what remains is the difference we care
 * about. Comparing two unpaired means here would hide a real effect inside split noise.
 */
function pairedT(left, right) {
  const differences = left.map((value, index) => value - right[index]);
  const spread = sampleStandardDeviation(differences);
  if (spread === 0 || differences.length < 2) return { t: 0, meanDifference: mean(differences), n: differences.length };
  return {
    t: mean(differences) / (spread / Math.sqrt(differences.length)),
    meanDifference: mean(differences),
    n: differences.length,
  };
}

function loadCorpus(explicitPath) {
  const source = explicitPath || riskScorer.DEFAULT_SEQUENCE_PATH;
  if (!fs.existsSync(source)) return { source, rows: null };
  return { source, rows: riskScorer.readJSONL(source) };
}

function resample(rows, options, resamples) {
  const collected = { iid: [], novel: [] };
  for (let index = 0; index < resamples; index += 1) {
    const model = riskScorer.trainRiskModel(rows, { ...options, splitSalt: `resample-${index}` });
    for (const [key, report] of [['iid', model.metrics.holdout], ['novel', model.metrics.holdoutNovelContext]]) {
      if (report && report.available) collected[key].push(report);
    }
  }
  return collected;
}

function summarize(reports) {
  if (!reports.length) return { available: false };
  const pick = (field) => reports.map((report) => Number(report[field])).filter(Number.isFinite);
  const lift = pick('lift');
  return {
    available: true,
    resamples: reports.length,
    meanTestCount: Math.round(mean(pick('testCount'))),
    lift: { mean: mean(lift), sd: standardDeviation(lift), foldsBeatingBaseline: lift.filter((value) => value > 0).length },
    rocAuc: { mean: mean(pick('rocAuc')), sd: standardDeviation(pick('rocAuc')) },
    mcc: { mean: mean(pick('mcc')), sd: standardDeviation(pick('mcc')) },
    brierScore: { mean: mean(pick('brierScore')) },
    expectedCalibrationError: { mean: mean(pick('expectedCalibrationError')) },
  };
}

function formatBlock(title, summary) {
  if (!summary.available) return `${title}\n  not measurable on this corpus\n`;
  const sign = summary.lift.mean >= 0 ? '+' : '';
  return [
    title,
    `  held-out lift vs majority baseline : ${sign}${summary.lift.mean.toFixed(4)} ± ${summary.lift.sd.toFixed(4)}`
      + `   (${summary.lift.foldsBeatingBaseline}/${summary.resamples} folds beat it)`,
    `  ROC-AUC                            : ${summary.rocAuc.mean.toFixed(4)} ± ${summary.rocAuc.sd.toFixed(4)}`,
    `  MCC                                : ${summary.mcc.mean.toFixed(4)} ± ${summary.mcc.sd.toFixed(4)}`,
    `  Brier / ECE                        : ${summary.brierScore.mean.toFixed(4)} / ${summary.expectedCalibrationError.mean.toFixed(4)}`,
    `  mean test fold                     : ${summary.meanTestCount} rows`,
    '',
  ].join('\n');
}

function main(argv) {
  const resamples = Math.max(2, Number(argv[argv.indexOf('--resamples') + 1]) || 12);
  const corpusFlag = argv.indexOf('--corpus');
  const { source, rows } = loadCorpus(corpusFlag !== -1 ? argv[corpusFlag + 1] : null);

  // NOTE ON WHICH CORPUS YOU GET: resolveFeedbackDir prefers a repo-local .thumbgate/ over the
  // global ~/.thumbgate. Inside a checkout that means the small test fixture, not the machine's
  // real feedback history — so both messages below name the path and how to override it, rather
  // than leaving someone to wonder why a 1,791-row corpus evaluated as 3 rows.
  if (!rows) {
    process.stderr.write(`eval-risk-model: no corpus at ${source}\n`
      + '  point it at one with: --corpus ~/.thumbgate/feedback-sequences.jsonl\n');
    return 2;
  }
  if (rows.length < 40) {
    process.stderr.write(`eval-risk-model: ${source} has only ${rows.length} rows — too few to hold anything out\n`
      + '  this is usually the repo-local fixture; for the real corpus use:\n'
      + '    node scripts/eval-risk-model.js --corpus ~/.thumbgate/feedback-sequences.jsonl\n');
    return 2;
  }

  const collected = resample(rows, {}, resamples);
  const iid = summarize(collected.iid);
  const novel = summarize(collected.novel);
  const inSample = riskScorer.trainRiskModel(rows, { skipHoldout: true }).metrics.trainingAccuracy;

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ source, rows: rows.length, resamples, inSample, iid, novel }, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(`Risk model evaluation — ${rows.length} rows from ${source}\n`);
  process.stdout.write(`${resamples} independent stratified, group-aware splits\n\n`);
  process.stdout.write(`in-sample accuracy: ${inSample.toFixed(4)}   <- NOT a quality number; kept only for comparison\n\n`);
  process.stdout.write(formatBlock('IID held-out (new rows, familiar kinds of action)', iid));
  process.stdout.write(formatBlock('Novel-context held-out (whole action types unseen in training)', novel));

  if (argv.includes('--compare-caps')) {
    // Answers a specific question that came up during design: boosting picked the same feature
    // six times out of eight, so does bounding that help? Measured, not assumed.
    process.stdout.write('Feature-diversity cap comparison (paired over identical splits)\n');
    const baseline = resample(rows, {}, resamples).iid.map((report) => report.lift);
    for (const cap of [1, 2, 3]) {
      const capped = resample(rows, { maxPerFeature: cap }, resamples).iid.map((report) => report.lift);
      const { t, meanDifference } = pairedT(capped, baseline);
      const verdict = Math.abs(t) > 2.2 ? 'SIGNIFICANT at p<0.05' : 'not significant';
      process.stdout.write(`  cap=${cap}: mean lift difference ${meanDifference >= 0 ? '+' : ''}${meanDifference.toFixed(4)}`
        + `  paired t=${t.toFixed(2)}  -> ${verdict}\n`);
    }
    process.stdout.write('\n');
  }

  return 0;
}

module.exports = { mean, standardDeviation, sampleStandardDeviation, pairedT, summarize, resample, main };

if (require.main && require.main.filename === module.filename) {
  process.exit(main(process.argv.slice(2)));
}
