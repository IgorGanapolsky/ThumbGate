#!/bin/bash
# Demo sandbox: a git repo, a sibling folder the agent should not delete, and
# Claude Code hooks written by the real `thumbgate init` (run from inside the sandbox).
S="${DEMO_DIR:-$(cd "$(dirname "$0")" && pwd)/.run}"
CLI="${THUMBGATE_CLI:-$(cd "$(dirname "$0")/../../.." && pwd)/bin/cli.js}"
mkdir -p "$S"; D=$S/demo
rm -rf $D; mkdir -p $D/home $D/work/api $D/fb
cd $D/work/api && git init -q -b main . && git config user.email d@x && git config user.name demo
printf 'def total(items):\n    return sum(i.price for i in items)\n' > app.py
git add . && git commit -qm "init"
mkdir -p ../old-notes && printf 'Q3 pricing draft\nrenewal list\n' > ../old-notes/pricing.txt
mkdir -p ../.keep && cp -r ../old-notes ../.keep/
HOME=$D/home THUMBGATE_FEEDBACK_DIR=$D/fb node $CLI init --agent claude > $D/init.log 2>&1; echo "init exit $?"
# project-level hooks for the sandbox = what init wrote into the throwaway home
mkdir -p $D/work/api/.claude
# keep only the PreToolUse gate hook: init's memory hooks would let the agent read past lessons and stop itself
node -e 'const s=require(process.argv[1]);require("fs").writeFileSync(process.argv[2],JSON.stringify({hooks:{PreToolUse:s.hooks.PreToolUse}},null,2))' $D/home/.claude/settings.local.json $D/work/api/.claude/settings.local.json
ls -a $D/work/api
