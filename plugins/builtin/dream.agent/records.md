# What a run leaves behind

```
agent-runs/dream-<stamp>-<target>/
  target.json          what the run is for, and which files it may change
  design.json          what the design agent spent and said
  setup.mjs            the frozen measure
  setup-check.json     the target's own score and the control's
  run.json             status, round, best — what the panel reads
  loop.log             the loop's own output
  report.md            the document, rewritten after every round
  graph.svg            score against attempts
  tree.svg             who descends from whom
  winner.json          the best version, and its improvement
  winner.patch         the winning diff
  history.json         the run's whole state in one file: rounds, attempts, best, cost
  rounds/r0001/
    c1.json            one candidate: verdict, evaluated, failClass, measures, tokens, duration, report
    c1.patch           what that candidate changed
    round.json         whether the round improved
```

## A Dream-RSI run's directory

Each attempt's `report` is carried into the next candidate's prompt, together
with the evaluator's measures and the status when a harness cut the attempt off.
A candidate that names the hotspot it measured, the numbers, and what it
rejected saves the next attempt from re-profiling the same scene.

`dream.rsi` writes the same target, setup and pictures, and its own records:

```
pool/                     one JSON grid per rollout: cells, outcomes, each cell's patch
policy/r001-v000.mjs      one phase's policy versions; the phase label keeps each round's apart
policy/current.mjs        the version the next round plays
replay/r001-v000.json     that version's sweep: mean reward, best beta, spread, failures
rsi/r001-b0a0.patch       one attempt's diff, named by round, branch and depth
rsi/round-001/grid.json   the grid as it stood after every attempt, so a rollout is watchable
rsi/round-001/rollout.json   what exploring cost: probes, decision rounds, attainment
rsi/round-001/dreaming.json  every version replayed, which won, what was deployed
rsi/round-001/rsi-b0-r001c1.json  one attempt's full record, written as it ended, with its patch path
dreaming.json             the last phase's versions and what it deployed
rsi-summary.json          the whole run: rounds, pool, best cell, improvement, cost
rsi.json                  live phase, round, plan, pool and policy — what the panel reads
winner.patch              the best attempt that was really made
```

`pool/` is the simulator. A policy is scored against every grid in it, so a
phase that ran after the pool grew is not comparable with one that ran before —
which is why the pool is frozen for the length of a dreaming phase.

## Resuming a run

A run is resumed by naming its directory. It continues after its last recorded
round and from the best version those rounds produced, so ten rounds may be run
as ten, or as three and then seven, without a record being overwritten:

```
node tools/dream/loop.mjs --run agent-runs/dream-<stamp>-<target> --rounds 7
```

`--rounds` is always how many more rounds this invocation may run. The rounds
already brought nothing are counted too, so a resumed run still stops when it has
stopped improving.

## Reading the pictures

`graph.svg` — one point per attempt in the order they ran. A green filled point
was kept; a grey point scored but did not beat the best so far; a hollow orange
point failed a check and scored zero, so the attempt was kept and may be passed
again; a hollow red point was refused, which means no score was produced. The
tooltip names the task that failed. The green step line is the running best, and
the dashed red line is the target as it stood. A higher line is a better value,
whether the weights were costs to lower or a quality to raise.

`tree.svg` — the lineage. Every candidate descends from the best version before
it, so the edges are the run's actual history rather than a tidy story. A refused
candidate is a leaf: the search went there and stopped going there.

## Landing a winner

`winner.patch` is a `git diff` against HEAD, taken in the candidate's worktree.
Apply it in the checkout, read it, run the checks, commit it:

```
git apply agent-runs/dream-<stamp>-<target>/winner.patch
node bin/engine.mjs check
```

A run never lands anything itself. It proposes; landing is a decision. A winner
the run could not write a patch for says so in `winner.json` as `patchMissing`,
and the document repeats it — an absent patch is never left to read as "nothing
to apply".

## Watching it go

A run spends agent calls for minutes, so watching it beats waiting for it:

```
node tools/dream/inspect.mjs                        # newest run, http://127.0.0.1:4317/
node tools/dream/inspect.mjs --run <directory> --port 4318 --open
```

The page reads the run directory every two seconds and shows the target, the
round, the pid and whether it is still alive, the frozen setup, every attempt
with its measures and cost, and both pictures. It serves on the loopback address
and writes nothing; stopping it loses nothing.

To rewrite one run's `report.md` and both pictures from its records — which is
how a run that finished before a change to `report.mjs` gets an up-to-date
document — without rerunning anything:

```
node tools/dream/report.mjs --run agent-runs/dream-<stamp>-<target>
```

## What it cost

Cost is reported in RMB, at the published price for the model the agents ran on.
The table lives in `tools/dream/pricing.mjs` with the page it was read from and
the day it was read, because prices change and a cost that cannot be traced to a
price is a guess wearing a currency symbol.

`deepseek-flash` is DeepSeek-V4.1-Flash: ¥2 an input million on a cache miss,
¥0.04 on a cache hit, and ¥8 an output million, at peak. Peak is Beijing working
hours, Monday to Friday 09:00-12:00 and 14:00-18:00; every other hour is half
price. Output tokens already include reasoning tokens — the three fields add up
to the recorded total, so adding reasoning again would double-bill it.

A cost is recomputed from the token records on every read, never stored as a
total. So a run made before pricing existed still shows one, and a price change
applies to old runs by reading them again.
