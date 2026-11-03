import { joinSession } from "@github/copilot-sdk/extension";

await joinSession({
  // Project-level GitHub Copilot extension (preToolUse hooks removed so Copilot is never blocked)
});
