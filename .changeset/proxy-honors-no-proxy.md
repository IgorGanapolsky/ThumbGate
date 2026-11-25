---
"thumbgate": patch
---

`thumbgate cfo`, `north-star` and the telemetry sync now honor `NO_PROXY`. Behind an HTTPS proxy they used to send every hosted request through it, including requests to localhost or internal hosts listed in `NO_PROXY`, which made those reads fail and fall back to local data.
