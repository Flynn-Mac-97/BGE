---
name: glass-dream
description: What a dream run is, how to start one over a target in this engine, and how to read what it wrote. Read this before running or changing the dream loop, or when a run refused to start.
---
<!-- generated from plugins/builtin/dream.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/dream.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/dream.js"]}'
```

# Dream

Dream improves one target by trying versions of it and scoring them against a
measure it designs for that target. The target is named in words — a file, an
algorithm, a workflow, the context an agent is handed — and a run decides what
"better" means for it, because that depends on the target.

Reach for it when a component has a cost you can measure and a correct answer
you can check, and you want the improvement found rather than typed.

## A run is three phases

1. **Design.** An agent reads the target and writes `setup.mjs`: the tasks, the
   checks, and what each measure costs in score.
2. **Check.** The setup must pass the target as it stands, and must fail the
   target with one literal break applied. A setup that passes both cannot tell
   an improvement from a regression, so it is refused and no round runs.
3. **Rounds.** Candidates follow, each one a version of the target built on the
   best version before it. A candidate that fails any task scores zero, whatever
   it saved.

Only the setup is frozen. Candidates may change the target and nothing else.

## Running one

```
node bin/engine.mjs dream.improve "make the agent context packet smaller without losing a rule"
```

In the editor the command is `ctrl+alt+d`, and the Dream panel takes the target
in its field. Options: `{ files, rounds, candidates, timeout, model }`.

`dream.status`, `dream.stop`, `dream.report` and `dream.forget` act on runs. A
run is refused when the tracked tree is dirty or when another agent holds a live
lane, because candidates branch from HEAD.

## What it leaves behind

One directory per run under `agent-runs/dream-<stamp>-<target>/`. It is the
run's whole state, and it is rewritten as the run goes:

- `report.md` — the target, the tasks, the control, every attempt, the winner
- `graph.svg` — score against attempts, with the target as a dashed floor
- `tree.svg` — who descends from whom, refused candidates as leaves
- `winner.patch` — the winning diff. Landing it is a separate command:

```
git apply agent-runs/dream-<stamp>-<target>/winner.patch
```

A run never edits the checkout. Every candidate is a worktree.

## Detail

Read only the file your task needs.

- `dream.agent/setup.md` — what the design phase writes, the helpers, and the control rule
- `dream.agent/records.md` — every file a run writes, and how to read the pictures
- `dream.agent/troubleshooting.md` — the refusals, and what each one wants
