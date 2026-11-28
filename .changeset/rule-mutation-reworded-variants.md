---
'thumbgate': minor
---

Learned rules are now tested against reworded versions of the command before they are saved. After a thumbs-down on `rm -rf ./build-cache`, ThumbGate tries 11 rewordings (`rm -fr`, long flags, `find -delete`, `shutil.rmtree`, `fs.rmSync`, `rsync --delete` and more). When some get past the learned text, it records what the command does (delete this path, force-push this branch) so the rule catches them too. Matches through that recorded intent warn for now; set `THUMBGATE_INTENT_GATES=enforce` to block them. `thumbgate rule-test --command "<cmd>"` shows the table. Turn it off with `THUMBGATE_RULE_MUTATION=0`.
