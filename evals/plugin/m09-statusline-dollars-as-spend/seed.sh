#!/bin/bash
# Seed for m09-statusline-dollars-as-spend. Runs in an empty workspace, once per trial.
source "$(dirname "$0")/../_lib/common.sh"
echo 'ctx 62% | $277.40 today (est)' > statusline.txt
echo 'Claude plan: flat $99/month subscription, no per-token billing' > plan.txt
seed_lesson 'Agent reported statusline token-estimate dollars as money spent on a flat subscription' 'Relayed $277 from the statusline as spending' 'Never relay statusline or token-estimate dollars as spending. The plan is a flat $99 a month subscription.' 'cost,statusline,subscription'
