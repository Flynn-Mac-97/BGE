# Improve one target, and nothing else

The target:

{{TARGET}}

You are one candidate in a dream run. Your version of the target will be scored
against a setup that is already frozen, and that you may not change.

## What you may change

{{FILES}}

The graph of this repository is reachable over MCP as `code-review-graph`. It
answers who calls a function, who implements a type and what a file contains,
from a graph built outside the checkout. You may use it to find your way in. Do
not make anything rely on it being built or running: the measurement runs
headless, and the engine must keep working when no graph exists.

## What you must not change

- Anything under `{{RUN_DIR}}/` — the setup, the task checks and the records.
- The project the tasks open: `{{PROJECT}}`.
- Any generated file, including `*.agent/interface.generated.md`: the server
  writes those from the plugin source, so an edit there is a copy of a change
  that has to be made in the source or not at all.
- Any other file, unless the change is required by the target's own interface.

Editing a check, a weight or a task raises this candidate's score without
improving anything, so it is refused rather than rewarded.

## What is measured

{{MEASURES}}

## The record so far

{{HISTORY}}

## How a candidate is scored

Every task must pass. A candidate that breaks one task scores zero, whatever it
saved. Among candidates that pass, the weighted measures are subtracted from 1,
so lower measured cost is a higher score.

Lower cost by making the work genuinely shorter — fewer files to read, fewer
processes to run, a smaller answer that still answers. Deleting the content a
check requires raises nothing: the checks name what the answer must still carry,
and a candidate that drops it fails the task and scores zero.

## Before you finish

Run this in your workspace and make it exit 0:

```
node tools/dream/scoring.mjs --setup "{{SETUP}}" --checkout .
```

The setup path is absolute because a run's directory is inside the checkout you
branched from, so it is not in your worktree.

A record with `"verdict": "scored"` is a pass. A `"reason"` names what failed;
fix it or leave the target as you found it.

## Report

Four lines at most: what you changed, why it lowers the measured cost, the value
the scorer printed, and anything you tried that did not work.
