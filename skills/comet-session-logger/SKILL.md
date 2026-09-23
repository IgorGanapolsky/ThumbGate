---
name: comet-session-logger
description: Live session logger and observability dashboard driver for Comet browser. Ensures every PR, deployment status check, CoderLegion/Dev.to publication, and Railway production health metric is actively logged and visualized in Comet tabs.
---

# ☄️ Comet Session Logger & Visual HUD

This skill governs the automated logging, tab orchestration, and visual tracking of all ThumbGate agentic tasks inside the **Comet** browser on macOS.

---

## 🎯 Purpose & Directives

1. **CEO Visual Observability:** The CEO monitors agent progress via open tabs in Comet. Every major milestone must be reflected in Comet tabs without disrupting existing work.
2. **Deterministic Tab Management:** Uses macOS AppleScript (`osascript`) to inspect, activate, create, or update Comet tabs.
3. **Fail-Safe & Non-Destructive:** Never closes existing tabs; always reuses matching URLs or opens clean dedicated monitoring tabs.

---

## 🧭 Standard Tab Targets

| Surface | Target URL | Trigger Milestone |
|---------|------------|-------------------|
| **Pull Requests** | `https://github.com/IgorGanapolsky/ThumbGate/pull/<NUM>` | After creating or advancing a PR |
| **CI / Checks** | `https://github.com/IgorGanapolsky/ThumbGate/actions` | During workflow verification |
| **Production Health** | `https://thumbgate-production.up.railway.app/health` | After deployment gate verification |
| **Railway Console** | `https://railway.com/project/thumbgate-production` | When inspecting infrastructure |
| **CoderLegion** | `https://coderlegion.com/import-post` | When onboarding or syndicating articles |
| **Dev.to Dashboard** | `https://dev.to/dashboard` | When tracking article reach & analytics |

---

## 🛠️ AppleScript Orchestration Helpers

```bash
# Check existing Comet tabs
osascript -e '
tell application "Comet"
    set outList to ""
    repeat with w in windows
        repeat with t in tabs of w
            set outList to outList & (URL of t) & " | " & (title of t) & linefeed
        end repeat
    end repeat
    return outList
end tell'

# Open or focus a specific URL in Comet
open_comet_url() {
  local target_url="$1"
  osascript -e "
  tell application \"Comet\"
      activate
      tell front window
          make new tab with properties {URL:\"${target_url}\"}
      end tell
  end tell"
}
```
