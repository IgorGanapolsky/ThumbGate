---
'thumbgate': patch
---

Match GitHub PR-create and helper-bypass gates on the action (POST to /pulls, current session) instead of substring /pulls + -f or a sibling session's scratch file (#3702).
