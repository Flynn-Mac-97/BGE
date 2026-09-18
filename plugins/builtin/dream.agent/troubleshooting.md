# Refusals, and what each one wants

## `preflight` refused

- **`another agent holds the lane <id>`** — a dream run does not race a lane.
  Finish or release it: `node bin/engine.mjs agent.status`.
- **`these tracked files are uncommitted`** — candidates branch from HEAD, so
  work that is not committed is work a candidate cannot see. Commit or stash.

## `the design agent did not finish`

Read `design.json` and `loop.log` in the run directory. Common causes: the model
was unavailable, the timeout was too short, or the agent wrote a `setup.mjs`
that does not load. Raise `--timeout` and start a new run. A run whose setup was
never written has nothing worth keeping: `dream.forget`.

## `the setup does not pass on the target as it stands`

The tasks are wrong about the engine, not about the target. This is the design
agent's job to fix, and it means starting a new run: the setup is frozen the
moment it passes.

## `the setup passes the target with the control's break applied`

The checks are too weak to notice a real regression, so every candidate would
score the same. Ask for a setup whose control fails a task, and say in the
target what a broken version looks like.

## `the setup changed: this run froze <a>, this checkout has <b>`

A candidate, or a person, edited `setup.mjs` during the run. The candidate is
refused. If a person did it, the run's earlier scores no longer mean anything:
start a new run.

## A run looks stopped but reads `running`

The loop writes `run.json` between candidates, so a long candidate shows the
previous round. Check the process: `run.json` records its `pid`. A crash before
the first round leaves `starting`.

## Every candidate is refused

Read one `c<N>.json`; `reason` names the task and what it saw. If all of them say
`the setup changed`, an earlier winner's patch conflicts with the setup's
expectations. If they say a task failed on the first attempt, the tasks are
stricter than the design phase measured — check `setup-check.json` and
`git status` for edits made after the freeze.
