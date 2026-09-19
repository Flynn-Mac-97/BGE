---
match: tools/dream/** agent-runs/dream-*
description: What a dream run is, how to start one over a target in this engine, and how to read what it wrote. Read this before running or changing the dream loop, or when a run refused to start.
category: core
---

# Dream

Dream improves one target by trying versions of it and scoring them against a
measure it designs for that target. The target is named in words — a file, an
algorithm, a workflow, the context an agent is handed — and a run decides what
"better" means for it, because that depends on the target.

Reach for it when a target has an objective you can measure and a correct answer
you can check — a cost to lower or a quality to raise — and you want the
improvement found rather than typed.

## A run is three phases

1. **Design.** An agent reads the target and writes `setup.mjs`: the tasks, the
   checks, the objective, and what each measure is worth in score. A negative
   weight is a quality gain; a positive weight is a cost.
2. **Check.** The setup must pass the target as it stands, and must fail the
   target with one literal break applied. A setup that passes both cannot tell
   an improvement from a regression, so it is refused and no round runs.
3. **Rounds.** Candidates follow, each one a version of the target built on the
   best version before it. A candidate that fails a check scores zero and keeps
   the attempt; a candidate the harness could not score is refused.

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

## Design, read the evaluator, then spend

`dream.improve` designs the evaluator and starts paying for candidates in one
call. The tools split it, so the evaluator is read before it costs anything:

```sh
node tools/dream/setup.mjs --target "<what to improve>"     # design and check, then stop
node tools/dream/loop.mjs --run agent-runs/dream-<stamp>-<slug> --rounds 2 --candidates 1
```

`loop.mjs` skips the design phase when the run directory already holds a
`setup.mjs`, so the setup is frozen the same way in two commands. Read
`setup.mjs` and `setup-check.json` between them: a setup that passes its control
can still measure the wrong thing, and the candidates are the expensive half.
The design phase alone costs a fraction of one candidate.

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
- `dream.agent/rsi.md` — the dreaming loop: grid, replay, policy revisions, redeploy
- `dream.agent/troubleshooting.md` — the refusals, and what each one wants
