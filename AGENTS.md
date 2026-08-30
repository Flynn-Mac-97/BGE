<!-- generated from agents/bootstrap.md -->
# Driving this engine

Files on disk are true. Read `ENGINE-BASE.md` first — the base instructions:
speech, code and comment style, and where everything is. Then read the
small instruction packet for your task:

```sh
node bin/engine.mjs agent.context engine/world.js
```

**To look at the game, never screenshot the browser.** The See plugin answers
visual questions exactly — what is on screen, what hides what, how something
moved — and exports a marked frame only when pixels are the question:

```sh
node bin/engine.mjs run see.describe                      # what is on screen, as facts
node bin/engine.mjs run see.capture '{"subject":"<id>"}'  # a marked frame of one thing
```

Read `plugins/builtin/see.agent.md` before any visual task. Enemies and
effects exist only while a run plays — `see.find '{"type":"<t>"}'` says what
exists right now, and `simulate` brings a moment about.

Use the **AGENTS** panel to see the instruction tree and switch optional skills on or off.

Use the current workspace for a small edit. Give each parallel writer a git worktree.

Run the checks named in the packet. Read `project/.engine/index.agent.json` before opening many project files.
