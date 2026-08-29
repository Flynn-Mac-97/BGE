# Agent output

Everything an agent makes that is not the engine and not the game. All of it is
a working artifact. All of it can be deleted — no code imports it, no check
depends on it.

```
agent-runs/
  painpoints.jsonl        the friction log, append-only
  <date>-<name>/          one round of work and whatever it produced
```

A round is a folder, so the next cannot bury the last. Name it for the day and
the thing built: `2026-08-29-counter-strike`. Put the briefs, the results, the
review findings, the cost, and any one-off page inside it.

`painpoints.jsonl` sits at the top because it outlives every round.

```sh
node bin/engine.mjs pain "<what was hard>" --kind engine --cost 4000 --where <path> --fix "<what would fix it>"
node bin/engine.mjs pain.list
node bin/engine.mjs pain.resolve p12 "<what you did>"
```

Append-only, so two agents at once both get their line. `ENGINE_PAIN_FILE`
points it elsewhere for a test.

Not here: instructions are input — `agents/`. A plugin's guide sits beside its
plugin as `<plugin>.agent.md`. Generated project state is `project/.engine/`.
