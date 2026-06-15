#!/usr/bin/env bash
set -eu

DEPLOYABLE_PATTERN='^(src/|scripts/.*\.(js|mjs|cjs)$|config/|adapters/.*\.(js|mjs|cjs|json|ya?ml|toml)$|public/|\.well-known/|openapi/|\.github/workflows/deploy-railway\.yml$|Dockerfile$|railway\.json$|package\.json$|package-lock\.json$)'

BEFORE_SHA="${BEFORE_SHA:-}"
HEAD_SHA="${HEAD_SHA:-${GITHUB_SHA:-}}"
EVENT_NAME="${EVENT_NAME:-${GITHUB_EVENT_NAME:-}}"
CHANGED_FILES=''
SHOULD_DEPLOY=true
SCOPE_REASON='default_deploy'

if [[ "$EVENT_NAME" == "workflow_dispatch" ]]; then
  SHOULD_DEPLOY=true
  SCOPE_REASON='workflow_dispatch'
elif [[ "$EVENT_NAME" == "push" && -n "$BEFORE_SHA" && "$BEFORE_SHA" != "0000000000000000000000000000000000000000" ]]; then
  if git cat-file -e "$BEFORE_SHA" 2>/dev/null; then
    CHANGED_FILES="$(git diff --name-only "$BEFORE_SHA" "$HEAD_SHA" | sed '/^$/d')"
    if [[ -n "$CHANGED_FILES" ]] && ! printf '%s\n' "$CHANGED_FILES" | grep -Eq "$DEPLOYABLE_PATTERN"; then
      SHOULD_DEPLOY=false
      SCOPE_REASON='non_runtime_changes'
    elif [[ -n "$CHANGED_FILES" ]]; then
      SHOULD_DEPLOY=true
      SCOPE_REASON='deployable_changes'
    else
      SHOULD_DEPLOY=true
      SCOPE_REASON='empty_push_range'
    fi
  else
    SHOULD_DEPLOY=true
    SCOPE_REASON='before_sha_unreachable'
    echo "::warning::BEFORE_SHA ($BEFORE_SHA) not reachable in shallow clone - deploying unconditionally"
  fi
fi

echo "before_sha=${BEFORE_SHA:-<none>}"
echo "head_sha=${HEAD_SHA:-<none>}"
echo "event_name=${EVENT_NAME:-<none>}"
echo 'changed_files:'
printf '%s\n' "${CHANGED_FILES:-<none>}"
echo "deployable_pattern=$DEPLOYABLE_PATTERN"
echo "should_deploy=$SHOULD_DEPLOY"
echo "scope_reason=$SCOPE_REASON"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "changed_files<<EOF"
    printf '%s\n' "$CHANGED_FILES"
    echo "EOF"
    echo "should_deploy=$SHOULD_DEPLOY"
    echo "scope_reason=$SCOPE_REASON"
    echo "deployable_pattern=$DEPLOYABLE_PATTERN"
  } >> "$GITHUB_OUTPUT"
fi

if [[ -n "${DEPLOY_SCOPE_OUTPUT_JSON:-}" ]]; then
  node - "$DEPLOY_SCOPE_OUTPUT_JSON" "$BEFORE_SHA" "$HEAD_SHA" "$EVENT_NAME" "$SHOULD_DEPLOY" "$SCOPE_REASON" "$DEPLOYABLE_PATTERN" "$CHANGED_FILES" <<'NODE'
const fs = require('fs');
const [
  outputPath,
  beforeSha,
  headSha,
  eventName,
  shouldDeploy,
  scopeReason,
  deployablePattern,
  changedFilesRaw,
] = process.argv.slice(2);

const changedFiles = String(changedFilesRaw || '')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

fs.writeFileSync(outputPath, JSON.stringify({
  beforeSha: beforeSha || null,
  headSha: headSha || null,
  eventName: eventName || null,
  shouldDeploy: shouldDeploy === 'true',
  scopeReason,
  deployablePattern,
  changedFiles,
}, null, 2) + '\n');
NODE
fi
