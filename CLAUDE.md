See [AGENTS.md](AGENTS.md) — it is generated and always current.

**Before any task, get your instruction packet** — it names the exact commands
for the job, and it is far cheaper than exploring:

```sh
node bin/engine.mjs agent.context '{"task":"<the task in your own words>"}'
```

**Never screenshot or read the editor page to see the game.** The See plugin
answers visual questions exactly: `run see.describe` (what is on screen, as
facts), `run see.capture '{"subject":"<id>"}'` (a marked frame of one thing),
`run see.find '{"type":"<t>"}'` (what exists right now). Enemies and effects
exist only while a run plays; `simulate` brings a moment about. A screenshot
costs fifty times more and answers less.
