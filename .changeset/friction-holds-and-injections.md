---
"thumbgate": patch
---

A thumbs-down hold no longer refuses read-only calls, and "fix it" releases it. Past-mistake notes appear only when they are about the call, once per session.
Injected lessons no longer quote the user's message back, pasted markup is stripped, and a lesson holding an email address or phone number is only shown when the call is about it.
The claim gate's Stop message is one line with no attached lessons, and current Claude Code shows it as hook feedback instead of a hook error.

A thumbs-down hold now covers the command that acted, not the setup in front of it (a shared credential export no longer holds unrelated commands, and adding one no longer slips past a hold).
