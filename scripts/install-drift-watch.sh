#!/usr/bin/env bash
# Install the published-enforcement drift check as a local launchd job.
#
# The check itself lives in .github/scripts/verify-published-enforcement.mjs and is also
# available as a manual GitHub Actions run. It is NOT scheduled in Actions on purpose:
# tests/ci-cd-hygiene-audit.test.js limits `schedule:` to codeql.yml, with the stated
# alternative that recurring loops "must run outside GitHub-hosted Actions or via
# workflow_dispatch". This script is that alternative.
#
# What it does: twice a day, install the CURRENTLY PUBLISHED thumbgate tarball into a temp
# prefix and run the evasion matrix against its public hook contract. If the published
# artifact can be walked past, it writes a loud failure to the log and exits non-zero, which
# launchd records.
#
# Why it matters: the test suite proves the SOURCE blocks what it claims. This proves the
# artifact users actually receive does — a different claim, and the one that was false for
# months while CI was green.
set -euo pipefail

LABEL="com.igor.thumbgate-drift-watch"
HOME_DIR="${HOME}"
TG_HOME="${HOME_DIR}/.thumbgate"
BIN_DIR="${TG_HOME}/bin"
LOG_DIR="${TG_HOME}/logs"
PLIST="${HOME_DIR}/Library/LaunchAgents/${LABEL}.plist"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NODE_BIN="$(command -v node || true)"
if [[ -z "${NODE_BIN}" ]]; then
  echo "install-drift-watch: node not found on PATH" >&2
  exit 2
fi

mkdir -p "${BIN_DIR}" "${LOG_DIR}"

# Copy the verifier and a small runner next to it so the job does not depend on this checkout
# still existing at its current path.
cp "${REPO_ROOT}/.github/scripts/verify-published-enforcement.mjs" "${BIN_DIR}/verify-published-enforcement.mjs"

cat > "${BIN_DIR}/drift-watch.sh" <<'RUNNER'
#!/usr/bin/env bash
# Install the published tarball into a throwaway prefix and verify it still enforces.
set -uo pipefail
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
cd "${WORK}"
npm init -y >/dev/null 2>&1
# --ignore-scripts: never run lifecycle scripts from a release we are checking BECAUSE we do
# not yet trust it.
if ! npm install --ignore-scripts --no-audit --no-fund thumbgate@latest >/dev/null 2>&1; then
  echo "$(date -u +%FT%TZ) INCONCLUSIVE: could not install thumbgate@latest"
  exit 2
fi
VERSION="$(node -e "console.log(require('${WORK}/node_modules/thumbgate/package.json').version)")"
# Sandboxed HOME so the matrix measures the engine, not local accumulated state.
SANDBOX="$(mktemp -d)"
OUT="$(HOME="${SANDBOX}" node "${HOME}/.thumbgate/bin/verify-published-enforcement.mjs" \
  "${WORK}/node_modules/thumbgate" 2>&1)"
STATUS=$?
rm -rf "${SANDBOX}"
echo "$(date -u +%FT%TZ) thumbgate@${VERSION} exit=${STATUS}"
echo "${OUT}"
if [[ "${STATUS}" -eq 1 ]]; then
  echo "!!! PUBLISHED ENFORCEMENT IS EVADABLE — roll back:"
  echo "    npm dist-tag add thumbgate@<last-good> latest"
  echo "    rm -rf ~/.thumbgate/runtime/node_modules"
  echo "    see docs/RELEASE-ROLLBACK.md and docs/INCIDENT-HOTFIX.md"
fi
exit "${STATUS}"
RUNNER
chmod +x "${BIN_DIR}/drift-watch.sh"

cat > "${PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${BIN_DIR}/drift-watch.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "${NODE_BIN}"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Hour</key><integer>20</integer><key>Minute</key><integer>30</integer></dict>
  </array>
  <key>StandardOutPath</key><string>${LOG_DIR}/drift-watch.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/drift-watch-error.log</string>
</dict>
</plist>
PLIST

plutil -lint "${PLIST}" >/dev/null
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${PLIST}"

echo "Installed ${LABEL} (08:30 and 20:30 daily)"
echo "  runner: ${BIN_DIR}/drift-watch.sh"
echo "  log:    ${LOG_DIR}/drift-watch.log"
echo "Run now with: launchctl kickstart -k gui/$(id -u)/${LABEL}"
