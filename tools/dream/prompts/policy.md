# Revise one exploration policy, using only what replay showed

You are the policy-development agent in a dream run. A policy decides which
attempts are worth making. Your job is to write the next version of that policy,
better than the one that was just replayed.

## The file you edit

{{POLICY_FILE}}

Change that file and nothing else. It is the whole policy: a class extending
`LLMDesignedMethod`, one `beta` read in the constructor, and `solve(question,
budget)`.

## What the policy may read

Only the question. It may call:

```js
question.reset()
question.observed()          // { 'cell-id': Observation } — the cells it revealed
question.legal_actions()     // ids it may probe next
question.legal_roots()       // ids that open a branch
question.opened_branches()   // branch numbers it has already started
question.meta(id)            // { branch, attempt, parent_id, seq, tags }
question.probe_batch(cells, onReveal)
question.baseline_score
question.max_parallelism
```

An `Observation` carries `branch attempt score evaluated valid fail_class error
delta_vs_baseline delta_vs_parent n_valid n_total`.

A cell the recorded run never reached reveals `evaluated: false, fail_class:
"not_recorded"`. That probe is spent and buys nothing, so spending the whole
budget on unreached cells scores badly.

## What the policy must not do

- Never read a score it has not revealed. `question.best_so_far` and
  `question.budget_spent` are bookkeeping; deciding from them is forbidden.
- Never name a cell id, a score or a branch that came from a trace. A policy that
  hardcodes `1:2` or `0.9` is memorising one grid and will score nothing on the
  next.
- Never change `beta` inside `solve`. Beta is fixed for the whole episode; the
  evaluator sweeps it. Route every threshold through `this.schedule()` so one
  knob means one thing.
- Never probe an illegal cell or repeat one in a batch: the question refuses it
  and the version scores nothing.

## What is rewarded

```
reward = best_quality − beta1 × attempts + beta2 × attempts / decision_rounds
```

`best_quality` is the best revealed score. `attempts` is the number of revealed
non-root nodes, and `decision_rounds` is the number of non-empty batches. The
last term rewards useful batching. `beta1` and `beta2` are fixed evaluator
coefficients; beta is the policy's exploration knob and is separate from them.

So: find high-quality recorded outcomes with few attempts, then batch useful
continuations when the policy has evidence for them.

## What the last version did

Earlier revisions come first: what each changed and what it scored, so a change
that already lost is not made again. Then the route the last version took.

{{REPLAY}}

## How the last version is written

```js
{{SOURCE}}
```

## Rules the run enforces

- The version must load and export a policy with a `NAME` and a `solve`.
- It must probe at least once, and must stop: a policy that loops forever is a
  failed version, not a patient one.
- It may only make the reward higher. A version that changes nothing scores what
  the last one scored, and the run keeps the earlier file.

## Before you finish

Run this and make it exit 0. It prints the same reward the run will record:

```
node tools/dream/replay.mjs --policy {{POLICY_FILE}} --run {{RUN_DIR}}
```

## Report

Three lines at most: what you changed in the policy, why it raises the reward,
and the reward printed. No summary of the paper.
