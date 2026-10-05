# Siren posting policy pack

Updated: 2026-10-05

Public policy for three Siren MCP tools. Source checked the same day:

- Skill: https://mcp.mysiren.ai/skill.md
- Human docs: https://mysiren.ai/docs/mcp
- Server: https://mcp.mysiren.ai/mcp

This file does not install Siren. It does not run inside Siren's cloud. It is the text a Siren doc can link when an agent is about to post.

Posting stays off until the human turns on **Allow posting** on the consent screen. A posting tool that lacks the `post` scope refuses. Do not retry that refusal. Tell the human to reconnect and turn Allow posting on, then stop.

Confirm with the human before any live post. For `post_run` and `schedule_post`, the run is already finished: show that asset and the caption, and wait for a yes. The agent cannot connect a channel. Posting uses a channel the human already connected in the Siren dashboard.

## Gates

### post_run — always

`post_run` publishes a finished run. It is live and public. It always needs Allow posting.

The call queues the post behind a short publish window of about two minutes. That window is cancellable. It does not fire inline. After the window, poll `get_run` and read `posts[].url` for the live permalink. Pass `caption` to send those words verbatim. Omit `caption` and Siren writes it at queue time, so `get_run` shows the words before they go out.

ThumbGate decision: **review**, always. Do not call `post_run` until the human has said yes and Allow posting is on.

### schedule_post — always

`schedule_post` queues a finished run for a named time. It always needs Allow posting. Platforms fire sequentially: X, LinkedIn, Instagram, TikTok, YouTube.

ThumbGate decision: **review**, always. Do not call `schedule_post` until the human has named the time and said yes.

### create_campaign — only when `scheduled_at` is set

`create_campaign` runs the pipeline from a brief and spends credits. A still is 10 credits. A film is 25. A platinum film is 50.

Passing `scheduled_at` queues a post for when the render succeeds. That form needs Allow posting. The asset does not exist at call time. Siren tells the agent to render first and show the asset before `post_run` and `schedule_post`. `scheduled_at` skips that preview: the post is queued when the render succeeds. The review here is the brief, the credit cost, and the time the human named. Say yes only if the human accepts that this post goes out from that brief and that time, with no second look at the finished asset.

Without `scheduled_at`, the call spends credits and does not post. This posting pack does not gate that form.

ThumbGate decision: **review** only when `scheduled_at` is present. A `create_campaign` with no `scheduled_at` is outside this pack.

## Same Allow posting rule on three other tools

Siren's skill names three more tools that need the `post` scope. They are not the three gates above. They are listed so a doc link is not narrower than Siren's own table.

| Tool | Needs Allow posting |
| --- | --- |
| `studio_schedule` | Always |
| `studio_card` | Only when `post` is true |
| `studio_automate` | Only when `delivery` carries `social_account_ids`. Telegram and Discord delivery are not posts. |

## What this pack does not say

- It does not require a "Video made with Siren" line.
- It does not set a dollar budget ceiling.
- It does not add a five-minute buffer on `schedule_post`. The cancellable window of about two minutes is the `post_run` publish queue Siren documents.
- It does not state ThumbGate prices, customers, or revenue.
