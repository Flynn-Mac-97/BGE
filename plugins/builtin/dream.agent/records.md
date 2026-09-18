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
  rounds/r0001/
    c1.json            one candidate: verdict, measures, tokens, duration, report
    c1.patch           what that candidate changed
    round.json         whether the round improved
```

## Reading the pictures

`graph.svg` — one point per attempt in the order they ran. A green filled point
was kept; a grey point scored but did not beat the best so far; a hollow red
point was refused, and its tooltip names the task that failed. The green step
line is the running best, and the dashed red line is the target as it stood.
Lower measured cost is a higher line.

`tree.svg` — the lineage. Every candidate descends from the best version before
it, so the edges are the run's actual history rather than a tidy story. A
refused candidate is a leaf: the search went there and stopped going there.

## Landing a winner

`winner.patch` is a `git diff` against HEAD, taken in the candidate's worktree.
Apply it in the checkout, read it, run the checks, commit it:

```
git apply agent-runs/dream-<stamp>-<target>/winner.patch
node bin/engine.mjs check
```

A run never lands anything itself. It proposes; landing is a decision.
