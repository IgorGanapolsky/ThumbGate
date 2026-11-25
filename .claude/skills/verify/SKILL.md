---
name: verify
description: Prove a ThumbGate change works before claiming it. Use before saying done, fixed, deployed, live or shipped.
---

1. Run the tests that cover the change by name
   (`node --test tests/<file>.test.js`, or the `npm run test:<area>` script
   that lists it). Run the whole suite only when asked or when more than a
   fifth of the selected tests fail.
2. For a hook or gate, pipe a real payload through it:
   `echo '<hook json>' | node scripts/<gate>.js pre` and check the
   `permissionDecision` in the output.
3. For a production change, after the merge wait for the Railway rebuild
   (about 3 minutes), then run:
   - `curl -s https://thumbgate.ai/health` and check `version` matches
     `package.json` and `buildSha` matches the merge commit;
   - `curl -sL https://thumbgate.ai/dashboard | grep -e 'ThumbGate Dashboard' -e 'Sign in to ThumbGate'`.
   If health still shows the old SHA, check Railway `list-deployments` before
   blaming the code.
4. For an npm release, `npm view thumbgate dist-tags`. A new version can take
   7 to 9 minutes to resolve.
5. Report the commands you ran and what they printed. Don't report success
   without them.
