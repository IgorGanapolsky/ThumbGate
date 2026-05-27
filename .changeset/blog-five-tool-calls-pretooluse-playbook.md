---
"thumbgate": patch
---

docs: blog post draft + pitch emails for "Five tool calls we never wanted Claude Code to make"

Companion piece to `docs/marketing/blog-acdc-runtime-enforcement-gap.md` and `public/learn/ac-dc-runtime-enforcement.html` (PR #2345). Where the AC/DC piece does the framework-level argument (Sonar named four stages; here's the missing fifth), this piece does the concrete five-rule walkthrough — `rm -rf` traversal, destructive SQL against non-test connections, `git push --force` to protected branches, MCP fetch to untrusted hosts, secret-carrying writes — each shown as a real JSON rule pattern with the failure mode it prevents and how the lesson promotes back into AC/DC's Guide stage.

Distribution priority corrected from the earlier PostHog-guest-post proposal: PostHog publishes customer case studies, not general guest posts, and ThumbGate uses Plausible (not PostHog), so we don't qualify. Primary target moves to The New Stack as a natural follow-up to their AC/DC framework coverage (Jennifer Riggins, who covers agentic SDLC). Fallback path is dev.to + Hacker News on day 1 if no TNS response, then Last Week in AI / Software Engineering Daily / Console.dev as roundup items on day 3.

Ships as a single new file in `docs/marketing/`:

- Pitch email (under 200 words, ready to send from Igor's account) targeting The New Stack
- Full ~1,500-word article body with the five rule patterns and an AC/DC stage-mapping table
- Honesty notes documenting that rules are starter-rule-set patterns, not real customer incidents (we have no paying customers yet)
- 5-day distribution plan with CEO action items isolated to "things the container can't do" (send the email, post to LinkedIn from Igor's account, submit to HN)

No code changes — content artifact only. Picks up the strategic thread from the AC/DC PR without holding it up.
