# Agent output

Everything an agent makes that is not the engine and not the game. **All of it
is a working artifact, and all of it can be deleted.** Nothing here is read by
the engine, no code imports it, and no check depends on it. Losing this
directory costs the record of how the work was done, not the work.

That is the point of a separate directory: the root stays the project, and a
round of parallel agents cannot bury it.

## What goes where

```
agent-runs/
  painpoints.jsonl        the friction log, append-only, written by `engine pain`
  <date>-<name>/          one round of work, whatever it produced
```

A round is a folder, so the next one cannot collide with the last. Name it for
the day it started and the thing it built — `2026-08-29-counter-strike`. Put
inside it whatever the round actually produced: the briefs the agents were
given, what they returned, what reviewers found, what it cost, and any
one-off page or sheet made to look at the result.

## The one exception

`painpoints.jsonl` sits at the top rather than inside a round, because it
outlives every round. It is the engine's own friction log — what was hard, what
it cost, and what would have fixed it — and `bin/engine.mjs` appends to it:

```sh
node bin/engine.mjs pain "<what was hard>" --kind engine --cost 4000
node bin/engine.mjs pain.list
node bin/engine.mjs pain.resolve p12 "<what you did>"
```

Append-only on purpose, so two agents working at once both get their line and
nothing rewrites what came before. `ENGINE_PAIN_FILE` points it elsewhere, so a
test can isolate the log.

## What does not go here

Instructions are input, not output — they live in `agents/`, and the AGENTS
panel edits them. A plugin's guide lives beside its plugin as
`<plugin>.agent.md`, because the loader finds it by name. Generated project
state lives in `project/.engine/` and is rebuilt on every write.
