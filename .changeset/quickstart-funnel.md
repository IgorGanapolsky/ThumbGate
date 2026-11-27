---
"thumbgate": patch
---

`thumbgate doctor` now sends an anonymous `cli_doctor_pass` or `cli_doctor_fail` event (off with `THUMBGATE_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`), and telemetry analytics reports `cli.quickStart`: installs that ran init, how many of those later got a passing doctor, and the completion rate.
