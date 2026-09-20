# Revise one exploration policy, using only what replay showed

You are the policy-development agent in a dream run. A policy decides which
attempts are worth making. Your job is to write the next version of that policy,
better than the one that was just replayed.

## The file you edit

{{POLICY_FILE}}

Change that file and nothing else. It is the whole policy: a class extending
`LLMDesignedMethod`, one `beta` read in the constructor, `solve(question,
budget)` and `plan_grid(context)`.

## What the policy may read

Only the question. It may call:

```js
question.reset()
question.observed()          // { 'cell-id': Observation } — the cells it revealed
question.legal_actions()     // ids it may probe next
question.legal_roots()       // ids that open a branch
question.opened_branches()   // branch numbers it has already started
question.meta(id)            // { branch, attempt, parent_id, seq, tags }
question.probe_batch(cells, onRevealOne)   // await it: a live probe buys an attempt
question.baseline_score
question.max_parallelism
```

An `Observation` carries `branch attempt score evaluated valid fail_class error
delta_vs_baseline delta_vs_parent n_valid n_total`.

A cell the recorded run never reached reveals `evaluated: false`, `valid: false`,
`fail_class: "not_recorded"` and `error: "this attempt was never made"`. That
probe is spent and buys nothing, so spending the whole budget on unreached cells
scores badly.

The four signals beside the API answer the judgements the rules below ask for.
`branchPromising(observations, branch)` returns `{ promising, anchored, climbing
}`; `branchFailedHard(observations, branch)` returns `{ hard, why }`;
`probeImprovedVsParent(probe)` and `probeImprovedVsBaseline(probe)` answer one
observation each. `successes(observations)` returns the successful evaluations.
The starter file already imports the first two; the rest are exported from the
same module. Use them rather than deriving the same judgement again from raw
observations.

## Success semantics

An evaluated observation with `error: null` and `fail_class: "ok"` is a
successful evaluation even when `valid` is false, or when `n_valid` and
`n_total` are null. Never call it repairable only because `valid` is false. A
*successful anchor* of a branch is the best score among that branch's successful
evaluations.

## Required branch trajectory and failure interpretation

For every opened branch, reconstruct its ordered prefix trajectory from
`question.observed()` and `question.meta(id)`, not only its latest observation
or its best score: the successful anchor, the score trend, the regressions, the
failure and repair sequence, and how deep the branch has gone against how much
depth is still legal.

Before closing or deprioritising a failed frontier, classify it as one of:
hard-unrecoverable; a repairable implementation failure; weak but underexplored;
repeatedly unpromising after enough valid evidence. Output or correctness
mismatch, resource limits, and variable, mask, layout or shape errors are
normally repairable. Do not infer algorithmic failure from one such error.
`n_valid === 0` and `branchFailedHard` are signals, not automatic closure: read
`fail_class` and `error` to tell a repairable zero-valid failure from an
environment or dependency failure. `compile_other` alone is not permanently
hard. Classify the current failure episode, and let a later success reopen the
branch and cancel a closure made on an earlier failure.

## The batch decision loop

At each decision round:

1. Read the prefix, rebuild every branch trajectory, and close only branches
   with cumulative evidence of being hard-unrecoverable or repeatedly
   unpromising.
2. Rank legal roots and legal branch frontiers from prefix-derived signals
   only: the successful anchor, the parent-to-child gain, the whole trajectory,
   success against failure evidence, recoverability, earlier repair outcomes,
   remaining depth, and the comparison across branches.
3. Rank actual repairable failures and underexplored frontiers in deterministic
   queues, ordered by trajectory, recoverability, remaining depth, repeated
   failures and beta. A repairable failure keeps its eligibility until
   cumulative evidence lowers its priority.
4. Build one dynamic portfolio batch, up to `question.max_parallelism`:
   exploitation (strong normal refinements), exploration (new roots or
   underexplored branches), and at most one recovery (an actual repairable
   failure). When several roles are eligible, give exploration and justified
   recovery a place before filling the remaining slots by priority, and adapt
   the mix to the prefix rather than to fixed quotas. Recovery must not push out
   a successful refinement, and no worker is left idle for want of a legal
   candidate. Never sample at random, and do not settle for one probe because
   the top candidate is clear.
5. Stop only after the whole revealed portfolio has been considered: active,
   underexplored, recoverable, unopened and still legal. Do not stop while an
   eligible high-priority recovery or underexplored candidate remains. Every
   remaining action needs an evidence-based decision to continue, reserve or
   close.

A batch holds distinct cells that are all legal *before* the call. It may hold
several roots, or one frontier from each opened branch. It must never hold a
parent and its child together: the child is not legal until the parent is
revealed. Do not use a fixed widen-all or deepen-all wave schedule; recompose
the batch after every revealed prefix.

The minimal solve shape:

```js
class Policy extends LLMDesignedMethod {
  async solve(question, budget = null) {
    question.reset()
    while (!this.budgetDone(question, budget)) {
      const prefix = question.observed()
      const batch = this.selectBatch(prefix, question)   // the portfolio rule above
      if (!batch.length) return                          // stop when no batch is selected
      await question.probe_batch(batch)
    }
  }
}
```

`selectBatch` is a helper the policy defines; it is not part of the question API.

## What is rewarded

The evaluator sweeps your single `beta` knob and ranks the resulting curve by
the paper's objective:

```
pareto.reward = pareto.auc - lambda * parallel_penalty
```

`pareto.auc` rewards reaching high per-trace attainment with few total probes.
`parallel_penalty` is the mean of `effective_sequential_rounds / total_probes`
over the sweep. A batch of `k` cells on `W = question.max_parallelism` workers
costs one decision round and `ceil(k / W)` effective sequential rounds, so a
serial policy has a penalty near 1 and a useful full batch approaches `1/W`.
`lambda` is a fixed evaluator coefficient.

`legacy` is the older equation `best_quality − beta1 × attempts + beta2 ×
attempts / decision_rounds`. It is not the ranked number. Its values are not
comparable with `pareto.reward`, so never compare the two and never tune the
policy towards a legacy figure. In the route lines below, `reward` is the
pareto reward; `bonus` belongs to the legacy equation and is not the ranked
number.

So find high-quality recorded outcomes with few probes, and batch independent
promising probes whenever the evidence supports them.

## Beta: fixed per episode, chosen across cycles

Beta has three separate roles. Do not conflate them:

1. Within one replay or live episode, beta is fixed: read it once in the
   constructor. Route every behavioural threshold through `this.schedule()`,
   which returns `{ beta, width, patience, exploreShare, recoverAfter,
   stopAfterFlat, reserveFloor }`. High beta means more width, deeper patience
   and weaker pruning; low beta means fewer probes, earlier stagnation stops and
   stronger pruning. Route recovery eligibility, the reserve threshold and the
   waiting through the same schedule. Never change `this.beta` inside `solve`: a
   policy that did would be adapting online, which is separate from the offline
   sweep that measures the trade-off.
2. During offline evaluation, the evaluator sweeps a fixed beta grid. That
   measures whether beta changes the attainment, work and parallelism
   trade-off. It is not online adaptation.
3. When you propose this version, choose the baked-in default beta once, from
   the evidence of earlier versions. That default stays fixed for the whole next
   episode.

Use this cross-cycle rule. Read the last two or three earlier versions and
their sweeps, never scores alone: the earlier-revision lines and the per-beta
sweep in this prompt, each round's live result under
`{{RUN_DIR}}/rsi/round-<n>/rollout.json` (`policy.beta`, `rollout.attained`,
`opened`, `probes`, `rounds`), and each version's full sweep under
`{{RUN_DIR}}/replay/`. Scores alone do not show that beta caused a change, so
read the live results and the sweeps together:

- the last live rounds are still improving: keep the previous default beta
  unless its sweep clearly shows a better nearby beta;
- they have plateaued, and a higher beta reaches higher attainment for a
  reasonable work and parallelism cost: raise the default by about 0.1 to 0.2,
  clamped to [0, 1];
- a high default has already been tried through a plateau, and the high-beta
  sweep points add work without higher attainment: lower it by a small step;
- the evidence is thin or conflicts: use a moderately exploratory default,
  about 0.6, rather than treating the replay ceiling as a live stopping signal.

The sweep is non-degenerate only when beta changes the attainment/work
trade-off, and it also shows whether the policy batches. Do not pick the
smallest beta that reaches a frozen trace's known ceiling.

## plan_grid is required

Every version must implement `plan_grid(context)`. It runs before a new grid
exists, reads no outcome of the current episode, and is synchronous: returning a
promise fails the round. It must return a plan on every path and must not fall
through to the runner's rule. When history is empty or insufficient, return an
explicit conservative bootstrap derived from the context and say the evidence is
insufficient.

`context` carries:

- `history` — completed earlier rounds, oldest first, each `{ number,
  plannedBranchCount, plannedRefineCount, planSource, planReason,
  effectiveBranchCount, effectiveRefineCount, openedWidth, openedDepth, probes,
  decisionRounds, attained, beta, bestAttempt }`;
- `fallback` — `{ branchCount, refineCount }` to start from;
- `hardMaxBranchCount`, `hardMaxRefineCount`, `maxParallelism`;
- `traceBranchCount`, `traceRefineCount` — the frozen trace's support, or null.

Return `gridPlan({ branchCount, refineCount, reason })`, imported from the same
module the file already imports `LLMDesignedMethod` from, or an object of that
shape. `planFromHistory({ history, fallback, hardMaxBranchCount,
hardMaxRefineCount })` is the conservative answer from those facts when you have
nothing better. The runner validates `1 <= branchCount <= hardMaxBranchCount`
and `0 <= refineCount <= hardMaxRefineCount`; outside that it stops the round
rather than clamping. The plan makes branches `0..branchCount-1` and attempts
`0..refineCount`, so `refineCount` is the refinements allowed after each root. A
plan beyond `traceBranchCount` or `traceRefineCount` is outside a frozen trace's
support and earns no replay reward.

Choose width against depth from evidence, not from a preference:

- many distinct roots improve early while deeper refinements stall: increase
  width, hold or reduce depth;
- high gains arrive late on a small, repeatable set of directions: hold or
  reduce width, increase depth;
- every explored direction plateaus after enough depth while direction classes
  remain uncovered: increase width;
- repeated hard, unrecoverable failures or strongly redundant directions:
  reduce width and depth conservatively;
- conflicting or insufficient history: return a conservative bootstrap from the
  context and state that the evidence is insufficient.

`plan_grid` decides how many directions exist. The direction provider gives new
roots their directions, and `solve` still decides which roots and frontiers to
open, refine, prune or stop. Do not favour a root because its branch id is
small. The planned grid is the hard bound: thresholds may use less of it, never
more.

## What the policy must not do

- Never read a score it has not revealed. `question.best_so_far` and
  `question.budget_spent` are bookkeeping; deciding from them is forbidden.
  Derive every decision statistic from `question.observed()`.
- Never name a cell id, a score or a branch that came from a trace. A policy
  that hardcodes `1:2` or `0.9` is memorising one grid and will score nothing on
  the next.
- Every prune, widen, deepen, batch and stop decision must be explainable from
  the current prefix. Shallow weak scores are not enough to discard a branch: a
  deeper attempt can recover. A repairable latest failure must not erase a
  branch's successful anchor or starve it.
- Never probe an illegal cell, repeat a cell in a batch, or send a batch above
  `question.max_parallelism`: the question refuses it and the version scores
  nothing.
- Never read a trace-specific branch, cell id, score or target inside `solve`.
- Keep every threshold relative to the prefix. Never use an absolute score
  cutoff.

## What earlier versions did, and the route the last one took

Earlier revisions come first: what each changed and what it scored, so a change
that already lost is not made again. Then the route the last version took. Start
from the strongest recent version, keep the mechanisms that raised the reward,
and make one concrete change when the reward stalls.

{{REPLAY}}

## How the last version is written

```js
{{SOURCE}}
```

## Rules the run enforces

- The version must load and export a policy with a `NAME`, a `solve` and a
  `plan_grid`.
- It must probe at least once, and it must stop. A policy that loops forever is
  a failed version, not a patient one.
- Replay calls `solve(question, null)`. Terminate when no batch is selected;
  never assume a budget cap exists.
- It may only make the reward higher. A version that changes nothing scores what
  the last one scored, and the run keeps the earlier file.

## The deliverable

Write the complete policy in `{{POLICY_FILE}}`. Open the file with a leading
`/** ... */` module comment that names: the prefix signals the policy uses, its
batch rule, its beta schedule, its default-beta rationale, its grid-planning
rule, and its safeguards against over-pruning, over-stopping, starvation after a
repairable failure, and serial probes.

Before you finish, verify the prefix-only rule, the stated success semantics,
that a zero-valid result does not close a branch by itself, that recovery
competes deterministically, and that the stop decision covers the whole
portfolio.

## Before you finish

Run this and make it exit 0. It prints the same reward the run will record:

```
node tools/dream/replay.mjs --policy {{POLICY_FILE}} --run {{RUN_DIR}}
```

## Report

Three lines at most: what you changed in the policy, why it raises the reward,
and the reward printed. No summary of the paper.
