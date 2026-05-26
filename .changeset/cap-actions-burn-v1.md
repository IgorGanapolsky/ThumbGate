---
"thumbgate": patch
---

ci: strip cron schedules from video-autopilot and instagram-autopilot

Both workflows already gated their publishing path off by default (low-engagement output) but kept firing on schedule (video every 4h = 180+ runs/month, instagram daily). Every run was a no-op that still booted Node, npm-installed, and burned the runner. Removing the `schedule:` trigger keeps the `workflow_dispatch` entry point so a manual run is still available, but stops the no-op burn.

Re-add the schedule when there is a proven content cadence that justifies the CI minutes.
