# Improve one target, and nothing else

The target:

{{TARGET}}

You are one candidate in a dream run. Your version of the target will be scored
against a setup that is already frozen, and that you may not change.

## What you may change

{{FILES}}

## What you must not change

- Anything under `{{RUN_DIR}}/` — the setup, the task checks and the records.
- The project the tasks open: `{{PROJECT}}`.
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

## Before you finish

Run this in your workspace and make it exit 0:

```
node tools/dream/scoring.mjs --setup {{RUN_DIR}}/setup.mjs --checkout {{WORKSPACE}}
```

A record with `"verdict": "scored"` is a pass. A `"reason"` names what failed;
fix it or leave the target as you found it.

## Report

Four lines at most: what you changed, why it lowers the measured cost, the value
the scorer printed, and anything you tried that did not work.
