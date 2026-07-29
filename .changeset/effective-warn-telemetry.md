---
thumbgate: patch
---

Separate raw policy matches from effective hook outcomes so warn-by-default
actions are reported as allowed warnings, strict denials as blocks, and
autonomous approval failures remain fail-closed. Populate the dashboard's
Active Gates card from the fast stats response instead of leaving it blank
while the full analytics payload loads.
