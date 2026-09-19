# Improve one target, and nothing else

The target:

{{TARGET}}

You are one candidate in a dream run. Your version of the target will be scored
against a setup that is already frozen, and that you may not change.

Start by understanding the contract and the current architecture. Consider at
least one structural alternative: a different index, data shape, module boundary,
algorithm, command route, or workflow. Keep the current layout only when it is
the best fit for the contract. If current external techniques matter, use the
available authoritative research and carry the useful constraint into the code.

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

The allowed scope is a boundary, not a request to preserve every existing file.
You may add or remove implementation files inside it when the contract and the
frozen tasks permit that design. Change the source or generator that owns a
generated file; never hand-edit its output.

Editing a check, a weight or a task raises this candidate's score without
improving anything, so it is refused rather than rewarded.

## What is measured

{{MEASURES}}

Objective: {{OBJECTIVE}}

## The record so far

{{HISTORY}}

## How a candidate is scored

A failed check scores zero, and the run keeps the attempt; it is not a crash, and
you may repair it. Among candidates that pass, each weighted measure is
subtracted from 1, so a positive weight is a cost and a negative weight is a
quality gain: read the objective below to see which way the value moves.

Improve the measured behavior first. Then reduce cost through a better route,
index, algorithm, or structure. Deleting content can win only when the frozen
tasks prove that it was duplicate and all required facts, links, commands, and
holdout routes remain available.

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

Four lines at most: what you changed, why it raises the value, the value the
scorer printed, and anything you tried that did not work.
