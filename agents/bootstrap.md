<!-- generated from agents/bootstrap.md -->
# Driving this engine

Files on disk are true. Read `ENGINE-BASE.md` first — the base instructions:
speech, code and comment style, and where everything lives. Then read the
small instruction packet for your task:

```sh
node bin/engine.mjs agent.context engine/world.js
```

Use the **AGENTS** panel to see the instruction tree and switch optional skills on or off.

Use the current workspace for a small edit. Give each parallel writer a git worktree.

Run the checks named in the packet. Read `project/.engine/index.agent.json` before opening many project files.
