# The dreaming loop

Two loops live in Dream. `dream.improve` improves the target and keeps its
measure fixed. `dream.rsi` improves the *exploration policy*, by replaying it over
attempts that were already made. This file is about the second.

```
node bin/engine.mjs dream.rsi "make working inside this engine's own source cheap for an agent"
```

Options: `{ rounds, versions, parallelism, timeout, model, harness }`. One round is:

1. **Plan a grid.** The current policy's `plan_grid(context)` states how many
   branches and how deep, from completed earlier rounds only — never from this
   round's outcomes: how wide to work is a decision about the next rollout. The
   runner's own widening/deepening rule answers only when the policy has no
   `plan_grid`. Capped at 4 branches and 4 refinements.
2. **Explore online.** The current policy names batches of cells. Every cell is a
   real attempt: a worktree branched from its parent's patch, an agent working in
   it, a score from the frozen setup. This is the only stage that makes real
   attempts, and the run's largest spend.
3. **Pool it.** The grid joins `pool/`, and the pool is frozen for the dreaming
   that follows.
4. **Dream.** The policy is revised `versions` times, and **every version is
   replayed over every grid in the pool** with a beta sweep. A replay calls no
   agent; it reveals outcomes that are already recorded. Each revision, however,
   does call a development agent, so the phase spends token calls too.
5. **Redeploy.** The valid version with the highest reward, the incumbent
   included, becomes `policy/current.mjs`, and the next round explores with it.

## The policy

A policy is one file: a class extending `LLMDesignedMethod`, one `beta` read in
the constructor, and `solve(question, budget)`. It may read only the question —
revealed observations, legal moves, the baseline score, `max_parallelism`.

```js
question.observed()          // { 'branch:attempt': Observation }
question.legal_actions()     // roots plus branch frontiers
question.probe_batch(cells)  // await it: a probe buys an attempt
question.meta(id)            // { branch, attempt, parent_id, seq, tags }
```

`best_so_far` and `budget_spent` exist and must not decide anything: reading them
is deciding from the evaluator's numbers rather than from what was revealed.

The default reward is the paper's page-6 equation (1):
`best_quality − beta1 × N + beta2 × N / max(1, decision_rounds)`. `best_quality`
is the best revealed score. `N = |T| − 1` counts every revealed non-root node,
branch openings included. `decision_rounds` counts non-empty batches. `beta1`
and `beta2` are fixed evaluator coefficients. The selected policy is the highest
valid score including the incumbent, so it is never worse than the policy the
phase started from. The policy's `beta` is a separate exploration knob.

The records name this default `legacy` for compatibility. `pareto`
(`pareto.auc − lambda × parallel_penalty`) is a local experimental alternative
inspired by the Appendix B.2 prompt; the paper publishes no exact formula for it.

## What a run records

```
pool/                    one JSON grid per round: cells, outcomes, which patch each cell is
policy/r001-v000.mjs     a phase's policy versions; the phase label keeps each round's apart
policy/current.mjs       the version the next round plays
replay/r001-v000.json    that version's sweep: mean reward, best beta, spread, failures
rsi/round-001/rollout.json   what exploring cost, and the plan it used
rsi/round-001/dreaming.json  every version replayed, which won, what was deployed
rsi/round-001/rsi-b0-r001c1.json  one attempt's full record, written as it ended
rsi/r001-b0a0.patch      that attempt's diff, named by its round, branch and depth
dreaming.json            the versions of the last dreaming phase, and what it deployed
rsi-summary.json         the whole run: rounds, pool, best cell, improvement, cost
rsi.json                 live phase, round, pool and policy — what the panel reads
winner.patch             the best attempted version, ready to land
```

## Picking a run back up

A run is resumed by naming its directory. It continues after its last recorded
round, plays the policy the last dreaming phase deployed, and plans from what the
rounds before it did:

```
node tools/dream/rsi.mjs --run agent-runs/dream-<stamp>-<target> --rounds 2 --versions 2 --parallelism 2 --timeout 900
```

`--target` is optional on a resume: the run directory holds it in `target.json`.
`--rounds` is how many more rounds this invocation may run. `--branches` with
`--refinements` pins the plan so the cost is knowable before it starts — cells are
attempts, and attempts are the expensive part.

Before resuming, look for a `stop` file in the run directory. `dream.stop` writes
one, and it outlives the process it was meant for, so a resume refuses until it is
removed rather than exiting zero having done nothing:

```
Remove-Item agent-runs/dream-<stamp>-<target>/stop
```

Watch it while it runs:

```
node tools/dream/inspect.mjs --port 4317
```

The page reads the run directory, the pool, the policy versions and the agent's
own transcript, so a working attempt is visible while it works. It draws the grid
cell by cell with the order each attempt was probed in, and the ranked reward
against beta beside attainment against probes.

Started as a managed background job, the shell that launched it can be reaped
while the server it spawned keeps running, and the job then reports a failure that
never happened. **The port is the truth, not the job status.** To find and stop the
one serving:

```
Get-NetTCPConnection -LocalPort 4317 -State Listen | Select-Object OwningProcess
Stop-Process -Id <pid>
```

## What a run has cost, and what it has left

`rsi-summary.json` carries the run's cost in RMB, and `rsi/round-###/attempts.json`
carries each attempt's token breakdown, its session and its patch. Prices live in
`tools/dream/pricing.mjs` with the page they were read from; a cost is recomputed
from the token records on every read, so a price change applies to old runs too.

## What is not the paper

- **Batches are not concurrent yet.** A batch is one decision round and is
  counted as one, which is what the parallelism penalty measures, but its
  attempts run one after another. Real concurrency needs the policy off the main
  thread, because a synchronous `probe_batch` cannot let a child process's events
  fire while it waits.
- **A failure class comes from the evaluator, not a task's own validators.**
  `n_valid` and `n_total` are the checks that passed against the checks that ran.
  A failed check is `fail_class: correctness` and keeps its branch; a thrown
  task or a moved setup is a harness failure and yields no score.
