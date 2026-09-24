<!-- generated from agents/bootstrap.md -->
# Driving this engine

Files on disk are true. Read `ENGINE-BASE.md` first — the base instructions:
speech, code and comment style, and where everything is.

**Before any task, get your instruction packet.** It names the exact commands
for the job, and it is far cheaper than exploring:

```sh
node bin/engine.mjs agent.context '{"task":"<the task in your own words>","files":["<file>"]}'
```

Name the files as soon as you know them. Most rule sets are chosen by the files
you touch, so a packet built from the task alone is short and says how many it
skipped. The words in the task route the right plugin's guide in, and only for
plugins the project has enabled. Every packet ends with `# Not included`: the
rule sets it withheld and why. Ask for one by id with
`'{"task":"...","nodes":["editor"]}'`.

Give a sub-agent the packet, not a summary of it. `agent.prepare` writes the
whole text beside the game it is for, and returns that path as `packet`; point
the brief at that file.

## Style

`agents/code-style.md` is the one set of rules for every file you write: code,
comments and design. Every packet carries it, and `node bin/engine.mjs check`
fails on each rule a tool can check. A project may replace it for its own
files.

## Seeing the game

**Never screenshot or read the editor page to see the game.** The See plugin
answers visual questions exactly: `run see.describe` (what is on screen, as
facts), `run see.capture '{"subject":"<id>"}'` (a marked frame of one thing),
`run see.find '{"type":"<t>"}'` (what exists right now). Enemies and effects
exist only while a run plays; `simulate` brings a moment about. A screenshot
costs fifty times more and answers less.

Ask `run description '{"type":"<t>"}'` for what a thing is meant to be. It is
what the author wrote, not what was measured, so a picture that disagrees with
it is the finding.

## Working

Use the **AGENTS** panel to see the instruction tree and switch optional skills on or off.

Use the current workspace for a small edit. Give each parallel writer a git worktree.

Run the checks named in the packet. Read `project/.engine/index.agent.json` before opening many project files.
