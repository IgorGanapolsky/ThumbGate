# graphify reference: add a URL and watch a folder

Load this when the user ran `/graphify add <url>` or passed `--watch`. Neither is part of the default build.

## For /graphify add

Fetch a URL and add it to the corpus, then update the graph.

```bash
# Pass URL/AUTHOR/CONTRIBUTOR via env (never interpolate into Python source).
export GRAPHIFY_URL='https://example.com/doc'
export GRAPHIFY_AUTHOR=''          # optional
export GRAPHIFY_CONTRIBUTOR=''     # optional
$(cat graphify-out/.graphify_python) -c "
import os, sys
from graphify.ingest import ingest
from pathlib import Path

url = os.environ['GRAPHIFY_URL']
author = os.environ.get('GRAPHIFY_AUTHOR') or None
contributor = os.environ.get('GRAPHIFY_CONTRIBUTOR') or None
try:
    out = ingest(url, Path('./raw'), author=author, contributor=contributor)
    print(f'Saved to {out}')
except ValueError as e:
    print(f'error: {e}', file=sys.stderr)
    sys.exit(1)
except RuntimeError as e:
    print(f'error: {e}', file=sys.stderr)
    sys.exit(1)
"
```

Set `GRAPHIFY_URL` (required) and optional `GRAPHIFY_AUTHOR` / `GRAPHIFY_CONTRIBUTOR` in the environment before running. If the command exits with an error, tell the user what went wrong - do not silently continue. After a successful save, automatically run the `--update` pipeline on `./raw` to merge the new file into the existing graph.

Supported URL types (auto-detected):
- YouTube / any video URL → audio downloaded via yt-dlp, transcribed to `.txt` on next run (requires `pip install 'graphifyy[video]'`)
- Twitter/X → fetched via oEmbed, saved as `.md` with tweet text and author
- arXiv → abstract + metadata saved as `.md`
- PDF → downloaded as `.pdf`
- Images (.png/.jpg/.webp) → downloaded, Claude vision extracts on next run
- Any webpage → converted to markdown via html2text

---

## For --watch

Start a background watcher that monitors a folder and auto-updates the graph when files change.

```bash
# Pass the watch root as a CLI argv (never splice into Python -c).
INPUT_PATH='./raw'
$(cat graphify-out/.graphify_python) -m graphify.watch "$INPUT_PATH" --debounce 3
```

Set shell var `INPUT_PATH` to the folder to watch. Behavior depends on what changed:

- **Code files only (.py, .ts, .go, etc.):** re-runs AST extraction + rebuild + cluster immediately, no LLM needed. `graph.json` and `GRAPH_REPORT.md` are updated automatically.
- **Docs, papers, or images:** writes a `graphify-out/needs_update` flag and prints a notification to run `/graphify --update` (LLM semantic re-extraction required).

Debounce (default 3s): waits until file activity stops before triggering, so a wave of parallel agent writes doesn't trigger a rebuild per file.

Press Ctrl+C to stop.

For agentic workflows: run `--watch` in a background terminal. Code changes from agent waves are picked up automatically between waves. If agents are also writing docs or notes, you'll need a manual `/graphify --update` after those waves.
