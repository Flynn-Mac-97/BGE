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
whole text to `<workspace>/project/.engine/agent-task.json`; point the brief at
that file.

## Style — this holds for every file you write

- Explain why, not what the code already says. Delete comments that no longer
  match the code.
- Say it straight: no metaphor, no analogy, no story. State the fact and the
  reason.
- State the rule, not the mistake that taught it. History is in git and the
  pain ledger.
- Literal verbs. A file is in a directory, not "sitting" there; a value is
  stored, not "living" somewhere.
- Never a long word where a short one works. Active voice. Cut every word doing
  no work — the reader is usually an agent, and every word costs a token.
- Full names: `context`, not `ctx`. Plain words that say what a thing does.
- One idea in one small function.

The full rules are `agents/code-style.md` and `agents/comment-style.md`, and
every packet carries them. A project may add its own on top for its own files;
these still hold.

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
