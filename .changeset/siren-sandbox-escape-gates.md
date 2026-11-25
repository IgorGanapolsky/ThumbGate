---
"thumbgate": minor
---

Five new default gates encode the boundary rules from Anthropic's Siren sandbox-escape evaluation: `sandbox-escape-host-breakout` (host PID 1, leaked file handles, host root mounts, core_pattern, cgroup release_agent), `sandbox-node-control-api` (container engine sockets, Docker TCP API, kubelet), `sandbox-cloud-identity-read` (cloud metadata endpoints and Kubernetes service account tokens, through Bash, Read or WebFetch), `sandbox-privileged-container` and `sandbox-host-persistence` (both need approval). 18 of 20 escape commands passed the previous defaults; all 20 are now stopped and ordinary container work still runs. New learn page: /learn/siren-agent-sandbox-escape-gates.
