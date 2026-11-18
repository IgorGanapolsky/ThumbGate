# Gate demo: how the recording was made

`public/media/thumbgate-gate-demo.mp4` is a recording of `demo.sh`. Typing is scripted. Every command's output is real: four Claude Code sessions (`claude -p`, model `sonnet`), four `thumbgate capture` calls, and one `gate-check` call.

What it shows: the agent runs `rm -rf ../old-notes` three times with no hard block. After three thumbs-downs for that command, a fourth session is denied by the PreToolUse hook and the folder survives. It ends on a delete the rule does not match (`python3 shutil.rmtree`), which is allowed with a warning.

Choices to know about:

- `THUMBGATE_STRICT_ENFORCEMENT=1` is on. Without it the gate only warns.
- Only the PreToolUse hook from `thumbgate init --agent claude` is installed in the sandbox. With the memory hooks too, the agent usually reads the earlier mistake and stops by itself, so the hook never gets to deny (seen in an earlier recording).
- A rule matches the command that was thumbed down, not its purpose. One thumbs-down only warns; three promote a block.
- The sandbox path and user name are replaced with `~` and `dev` in the output.

Reproduce (needs `claude`, a signed-in Claude Code, and `asciinema`):

```bash
bash docs/demo/gate-demo/setup.sh
asciinema rec --window-size 100x32 --idle-time-limit 2.5 -c "bash docs/demo/gate-demo/demo.sh" gate-demo.cast
agg --font-size 18 --speed 1.25 --theme github-dark gate-demo.cast gate-demo.gif   # then ffmpeg to mp4
```

The agent's wording differs between runs. The deny in session 4 is deterministic once three thumbs-downs exist. `docs/demo/gate-demo.cast` is the recording the MP4 was made from.
