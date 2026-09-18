# The dreaming loop

Two loops live in Dream. `dream.improve` improves the target and keeps its
measure fixed. `dream.rsi` improves the *exploration policy*, by replaying it over
attempts that were already made. This file is about the second.

```
node bin/engine.mjs dream.rsi "make working inside this engine's own source cheap for an agent"
```

Options: `{ rounds, versions, parallelism, timeout, model }`. One round is:

1. **Plan a grid.** How many branches and how deep, from what earlier rounds did —
   a win at a branch root widens, a late win deepens, early gains narrow it. Never
   from this round's outcomes: how wide to work is a decision about the next
   rollout. Capped at 4 branches and 4 refinements.
2. **Explore online.** The current policy names batches of cells. Every cell is a
   real attempt: a worktree branched from its parent's patch, an agent working in
   it, a score from the frozen setup. This is the only stage that costs anything.
3. **Pool it.** The grid joins `pool/`, and the pool is frozen for the dreaming
   that follows.
4. **Dream.** The policy is revised `versions` times, and **every version is
   replayed over every grid in the pool** with a beta sweep. No agent is called:
   a replay reveals outcomes that are already recorded.
5. **Redeploy.** The version with the best average reward becomes
   `policy/current.mjs`, and the next round explores with it.

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

The reward is the paper's: `auc − lambda × parallel_penalty`, where `auc` is mean
attainment over the probes spent and the penalty is total effective sequential
rounds over total probes. A serial policy scores 1; one that fills its workers
approaches `1 / max_parallelism`.

## What a run records

```
pool/            one JSON grid per round: cells, outcomes, which patch each cell is
policy/v000.mjs  the policy a round started from, and every revision
policy/current.mjs  the version the next round plays
replay/v000.json the sweep scores: mean reward, best beta, spread, failures
rsi/round-001/{rollout.json, dreaming.json}
dreaming.json    the versions of the last dreaming phase, and what it deployed
rsi-summary.json the whole run: rounds, pool, best cell, improvement, cost
rsi.json         live phase, round, pool and policy — what the panel reads
winner.patch     the best attempted version, ready to land
```

## What is not the paper

- **Batches are not concurrent yet.** A batch is one decision round and is
  counted as one, which is what the parallelism penalty measures, but its
  attempts run one after another. Real concurrency needs the policy off the main
  thread, because a synchronous `probe_batch` cannot let a child process's events
  fire while it waits.
- **`n_valid` and `n_total` are null.** They are a task's own validator counts and
  this engine's runs record a verdict and its measures instead.
