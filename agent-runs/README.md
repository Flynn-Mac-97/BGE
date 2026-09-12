# Agent output

Everything an agent makes that is not the engine and not the game. Working
material, not engine content: no code imports it and no check depends on it.

```
agent-runs/
  README.md               this file
  painpoints.jsonl        the friction log, append-only
  insights.jsonl          the solutions log, append-only
  <date>-<name>/          one round of work — never committed, swept after a week
```

Only those three files are committed. Everything else is ignored by git and
deleted by `node bin/engine.mjs agent.sweep` once it is seven days old. Use
`--dry-run` to see what would go, `--days N` for a different age.

A round is a folder, so the next cannot bury the last. Name it for the day and
the thing built: `2026-08-29-counter-strike`. Put the briefs, the results, the
review findings, the cost, and any one-off page inside it.

## What survives a round

Agent output grows faster than anyone reads it, and a directory nobody can sift
through hides the two ledgers that matter. So a finding only keeps if it goes
somewhere a future agent already looks:

| the finding | where it goes |
|---|---|
| the engine made something hard | `pain` |
| a method worth reusing | `insight` |
| a rule for driving one plugin | that plugin's `.agent.md` |
| a rule for every task | `agents/core.md` |
| a behaviour that would break silently | a test in `test/` |
| anything else | here, and it is deleted |

Never leave a finding in a new markdown file. Nothing reads it, and it is swept.

## The friction log

What the engine made hard, and what that cost.

```sh
node bin/engine.mjs pain "<what was hard>" --kind engine --cost 4000 --where <path> --fix "<what would fix it>"
node bin/engine.mjs pain.list
node bin/engine.mjs pain.resolve p12 "<what you did>"
```

## The solutions log

The other half. A painpoint says the engine made something hard; an insight
says an agent found a way through, and names what the next one saves by not
working it out again. An un-adopted insight with a large saving is the next
thing to build, the way an open painpoint with a large cost is the next thing
to fix.

```sh
node bin/engine.mjs insight "<what worked>" --kind method --problem "<when to use it>" \
  --saves 4000 --where <path> --tool "<what would make this one step>"
node bin/engine.mjs insight.list "<words>"      # search everything, adopted or not
node bin/engine.mjs insight.list                # the un-adopted ones, ranked by saving
node bin/engine.mjs insight.adopt i7 "<the tool that now does it>"
```

`--problem` is the search key: an insight nobody can find again is a diary
entry. `--kind method` is a way of working rather than one surface, and most
insights are one; the other four kinds match the painpoint kinds so a fix and
its discovery group together.

Both logs are append-only, so two agents at once each get their line.
`ENGINE_PAIN_FILE` and `ENGINE_INSIGHT_FILE` point one elsewhere for a test.

Not here: instructions are input — `agents/`. A plugin's guide sits beside its
plugin as `<plugin>.agent.md`. Generated project state is `project/.engine/`.
