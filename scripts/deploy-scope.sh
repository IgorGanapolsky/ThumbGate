#!/usr/bin/env bash
set -eu

DEPLOYABLE_PATTERN='^(src/|scripts/.*\.(js|mjs|cjs)$|config/|adapters/.*\.(js|mjs|cjs|json|ya?ml|toml)$|public/|\.well-known/|openapi/|\.github/workflows/deploy-railway\.yml$|Dockerfile$|railway\.json$|package\.json$|package-lock\.json$)'

BEFORE_SHA="${BEFORE_SHA:-}"
HEAD_SHA="${HEAD_SHA:-${GITHUB_SHA:-}}"
EVENT_NAME="${EVENT_NAME:-${GITHUB_EVENT_NAME:-}}"
CHANGED_FILES=''
SHOULD_DEPLOY=true
SCOPE_REASON='default_deploy'

# Positively determine production's currently-deployed commit SHA, if we can.
# Order: explicit override (tests / pre-fetched) then the live /health buildSha.
# Prints the SHA on success; prints nothing when unknown/unreachable. Always exits 0
# so `set -e` never trips on a transient health blip.
get_deployed_sha() {
  if [[ -n "${DEPLOY_SCOPE_DEPLOYED_SHA:-}" ]]; then
    printf '%s' "$DEPLOY_SCOPE_DEPLOYED_SHA"
    return 0
  fi
  local url="${RAILWAY_HEALTHCHECK_URL:-}"
  if [[ -z "$url" ]]; then
    return 0
  fi
  local body
  body="$(curl -fsS --max-time 10 "$url" 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    return 0
  fi
  printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d;}).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).buildSha||""));}catch(_){process.stdout.write("");}});' 2>/dev/null || true
  return 0
}

if [[ "$EVENT_NAME" == "workflow_dispatch" ]]; then
  SHOULD_DEPLOY=true
  SCOPE_REASON='workflow_dispatch'
elif [[ "$EVENT_NAME" == "push" && -n "$BEFORE_SHA" && "$BEFORE_SHA" != "0000000000000000000000000000000000000000" ]]; then
  if git cat-file -e "$BEFORE_SHA" 2>/dev/null; then
    CHANGED_FILES="$(git diff --name-only "$BEFORE_SHA" "$HEAD_SHA" | sed '/^$/d')"
    if [[ -n "$CHANGED_FILES" ]] && ! printf '%s\n' "$CHANGED_FILES" | grep -Eq "$DEPLOYABLE_PATTERN"; then
      # No runtime-serving files changed in this push, so normally we skip the deploy.
      # BUT only skip if production is already serving HEAD. If we can positively confirm
      # the live build SHA is behind HEAD, an earlier deploy was skipped or failed and prod
      # has drifted behind main — force a catch-up deploy so main HEAD actually ships.
      # When the deployed SHA is unknown/unreachable we preserve the historical skip
      # (fail-safe: never block a merge on a health blip).
      DEPLOYED_SHA="$(get_deployed_sha || true)"
      if [[ -n "$DEPLOYED_SHA" && "$DEPLOYED_SHA" != "$HEAD_SHA" ]]; then
        SHOULD_DEPLOY=true
        SCOPE_REASON='prod_behind_head'
        echo "::notice::Deploy forced: live build ${DEPLOYED_SHA} is behind main HEAD ${HEAD_SHA}; catching up despite a non-runtime push."
      else
        SHOULD_DEPLOY=false
        SCOPE_REASON='non_runtime_changes'
      fi
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
