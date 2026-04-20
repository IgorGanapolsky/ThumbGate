'use strict';

const DEFAULT_MAX_SUBMISSIONS = 1;

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isOpenPr(pr) {
  return String(pr && pr.state ? pr.state : 'OPEN').toUpperCase() === 'OPEN';
}

function isTrunkMergeHeadRef(headRefName = '') {
  return /^trunk-merge\/pr-\d+\//i.test(String(headRefName || '').trim());
}

function getTrunkParentNumberFromRef(headRefName = '') {
  const match = String(headRefName || '').trim().match(/^trunk-merge\/pr-(\d+)\//i);
  return match ? Number(match[1]) : null;
}

function classifyPrLane(pr) {
  const headRefName = normalizeText(pr && pr.headRefName);
  const title = normalizeText(pr && pr.title);
  const haystack = `${title} ${headRefName}`.trim();

  if (isTrunkMergeHeadRef(headRefName)) {
    return 'trunk_shadow';
  }

  if (/chore\(release\)|\brelease\b|version\s+\d+\.\d+\.\d+/i.test(haystack)) {
    return 'release';
  }

  if (/workflow|ci|sonar|queue|automerge|pr-manager|publish|deploy|merge conductor|merge-conductor/i.test(haystack)) {
    return 'workflow';
  }

  if (/^dependabot\//.test(headRefName) || /\bdependabot\b/.test(haystack)) {
    return 'dependency';
  }

  return 'feature';
}

function lanePriority(lane) {
  switch (lane) {
    case 'release':
      return 0;
    case 'workflow':
      return 1;
    case 'dependency':
      return 2;
    case 'feature':
      return 3;
    case 'trunk_shadow':
      return 4;
    default:
      return 9;
  }
}

function isReleaseLockCandidate(entry) {
  return entry.outcome && entry.outcome.status === 'ready' && classifyPrLane(entry.pr) === 'release';
}

function applyBlockedOutcome(entry, reason, extras = {}) {
  return {
    number: entry.pr.number,
    title: entry.pr.title,
    outcome: {
      ...entry.outcome,
      status: 'blocked',
      reason,
      ...extras,
    },
  };
}

function planMergeConductor(entries, options = {}) {
  const normalizedEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const maxSubmissions = Number.isFinite(options.maxSubmissions)
    ? options.maxSubmissions
    : DEFAULT_MAX_SUBMISSIONS;

  const openEntries = normalizedEntries.filter((entry) => isOpenPr(entry.pr));
  const trunkShadowParents = new Set(
    openEntries
      .filter((entry) => entry.pr.isDraft && isTrunkMergeHeadRef(entry.pr.headRefName))
      .map((entry) => getTrunkParentNumberFromRef(entry.pr.headRefName))
      .filter((value) => Number.isFinite(value))
  );

  const releaseLockActive = openEntries.some(isReleaseLockCandidate);
  const selected = [];
  const blocked = [];

  const eligible = openEntries
    .filter((entry) => !isTrunkMergeHeadRef(entry.pr.headRefName))
    .filter((entry) => entry.outcome && entry.outcome.status === 'ready')
    .map((entry) => ({
      ...entry,
      lane: classifyPrLane(entry.pr),
    }))
    .sort((left, right) => {
      const laneDelta = lanePriority(left.lane) - lanePriority(right.lane);
      if (laneDelta !== 0) return laneDelta;
      return Number(left.pr.number) - Number(right.pr.number);
    });

  for (const entry of openEntries) {
    if (isTrunkMergeHeadRef(entry.pr.headRefName)) {
      blocked.push({
        number: entry.pr.number,
        title: entry.pr.title,
        outcome: { status: 'skipped', reason: 'trunk_shadow_pr' },
      });
      continue;
    }

    if (trunkShadowParents.has(Number(entry.pr.number))) {
      blocked.push(applyBlockedOutcome(entry, 'waiting_on_trunk', { lane: classifyPrLane(entry.pr) }));
    }
  }

  let remainingSlots = Math.max(0, maxSubmissions);
  for (const entry of eligible) {
    if (trunkShadowParents.has(Number(entry.pr.number))) {
      continue;
    }

    if (releaseLockActive && entry.lane !== 'release' && entry.lane !== 'workflow') {
      blocked.push(applyBlockedOutcome(entry, 'release_lock', { lane: entry.lane }));
      continue;
    }

    if (remainingSlots > 0) {
      selected.push(entry);
      remainingSlots -= 1;
      continue;
    }

    blocked.push(applyBlockedOutcome(entry, 'queue_backpressure', { lane: entry.lane }));
  }

  return {
    releaseLockActive,
    trunkShadowParents: [...trunkShadowParents].sort((left, right) => left - right),
    selectedNumbers: selected.map((entry) => entry.pr.number),
    selectedSet: new Set(selected.map((entry) => entry.pr.number)),
    blockedByNumber: new Map(blocked.map((entry) => [entry.number, entry])),
  };
}

module.exports = {
  classifyPrLane,
  getTrunkParentNumberFromRef,
  isTrunkMergeHeadRef,
  planMergeConductor,
};
