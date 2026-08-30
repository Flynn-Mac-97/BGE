<!-- generated from agents/bootstrap.md -->
# Driving this engine

Files on disk are true. Read `ENGINE-BASE.md` first — the base instructions:
speech, code and comment style, and where everything is. Then read the
small instruction packet for your task:

```sh
node bin/engine.mjs agent.context engine/world.js
```

**Never screenshot the browser to see the game.** Ask for your packet with the
task in your own words — the words route the right plugin's guide in, and only
for plugins the project has enabled:

```sh
node bin/engine.mjs agent.context '{"task":"have a look at the rat model"}'
```

The packet names the exact commands. Enemies and effects exist only while a
run plays; `simulate` brings a moment about.

Use the **AGENTS** panel to see the instruction tree and switch optional skills on or off.

Use the current workspace for a small edit. Give each parallel writer a git worktree.

Run the checks named in the packet. Read `project/.engine/index.agent.json` before opening many project files.
