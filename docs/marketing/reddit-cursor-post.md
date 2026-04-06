# Reddit Post: r/cursor

**Subreddit:** r/cursor
**Account:** u/eazyigz123
**Post type:** Discussion / question — problem-first, no product links in body

---

**Title:** Does Cursor retain anything you've corrected between sessions?

---

**Body:**

I keep running into the same thing: I correct Cursor mid-session — "don't force-push," "always run tests before committing," "use the existing helper, don't write a new one" — and it listens. That session is great.

Next session? Groundhog Day. Same force-push. Same skipped tests. Same duplicate helper.

What finally worked for me was dead simple: **thumbs down the mistake.** Not just a mental note — an actual structured signal: what went wrong, what to change. The system turns that 👎 into a prevention rule, and the agent is physically blocked from repeating it next time.

👍 works too — it reinforces the behavior you want to keep. Over time, the good patterns strengthen and the bad ones literally can't execute.

No prompt engineering. No manually updating `.cursorrules` every session. You just react with 👍 or 👎 as you work, and the enforcement builds itself from your feedback.

The agent literally can't repeat a known mistake once a rule exists for it.

Curious how others are handling cross-session reliability. Are `.cursorrules` and manual prompting enough for your workflow, or have you found something that sticks better?

---

**Comment (post immediately after the main post):**

The problem: AI coding agents repeat the same mistakes every session. You correct a force-push, it does it again tomorrow. Cursor rules get ignored when context is tight.

ThumbGate fixes this with enforcement, not memory. You give a thumbs-down, it auto-generates a prevention rule, and a gate physically blocks the agent from repeating that action. Thumbs-up reinforces good behavior.

Works with Cursor, Claude Code, Codex, Gemini, and Amp. Fully local, MIT licensed.

Try free for 7 days (no credit card, 2-minute setup): https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=organic_social&utm_campaign=reddit_followup_comment&utm_content=cursor_post&community=cursor

Source code: https://github.com/IgorGanapolsky/ThumbGate

Disclosure: I built this.
