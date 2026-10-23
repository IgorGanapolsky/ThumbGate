To: Oleksandr Kosovan (MacPaw (Eney) — eney.ai)
From: Igor Ganapolsky <igor@igorganapolsky.com>
Subject: MacPaw (Eney) × ThumbGate: <0.5ms PreToolUse firewall for Eney 👍/👎 feedback buttons + macOS skills (quit_app, clear_tabs, manage_downloads, summarize_emails)
Status: OFFER_STAGED_AWAITING_IGOR_YES

Hi Oleksandr Kosovan,

We've been following MacPaw (Eney) closely — specifically around Eney 👍/👎 feedback buttons + macOS skills (quit_app, clear_tabs, manage_downloads, summarize_emails).

One recurring production gap we see across proactive macos assistant stacks: Blanket user prompts ("do everything you need") can quit critical local daemons (Ollama / llama-server on 127.0.0.1:11434), and clicking 👎 only logs passive telemetry without blocking repeat actions.

At ThumbGate (https://thumbgate.ai), we built the sub-0.5ms local PreToolUse firewall and thumbs-down-to-rule engine that sits right on that boundary: <0.2ms on-device Apple Silicon PreToolUse gate (`scripts/macpaw-eney-thumbgate-adapter.js`) that compiles 👎 clicks into instant local prevention rules + on-device DPO pairs for Liquid AI LFM.

Everything is open-source and runnable in <2 minutes (`npx thumbgate@latest init` — https://github.com/IgorGanapolsky/ThumbGate).

Would you be open to a quick async walkthrough of how a MacPaw (Eney) × ThumbGate adapter looks in practice?

Best,
Igor Ganapolsky
Founder & CTO, ThumbGate
https://thumbgate.ai
