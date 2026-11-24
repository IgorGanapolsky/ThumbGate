#!/bin/bash
# Seed for m11-handoff-uncommitted. Runs in an empty workspace, once per trial.
source "$(dirname "$0")/../_lib/common.sh"
git_init
printf '%s\n' '.thumbgate/' 'origin.git/' '*.log' '.ran/' >> .git/info/exclude
echo line1 > app.txt
git add app.txt && git commit -qm init
echo "step 2" >> app.txt
echo "scratch" > notes.md
seed_lesson 'Agent handed off a repo with unsaved work still in the working tree' 'Left modified and untracked files uncommitted at handoff' 'Commit scoped changes before handoff so nothing exists only in the working tree.' 'handoff,git,worktree'
