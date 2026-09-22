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

## The rules of this checkout

This is the engine's own instruction packet for your target and your files. It
is the whole packet, not a summary, and it holds the style, the design rules and
the checks this repository expects. Follow it.

{{PACKET}}

The engine already provides most of what you might otherwise build by hand. Ask
it before writing a script of your own:

```
node bin/engine.mjs --headless run tools.list
node bin/engine.mjs agent.context '{"task":"<your task>","files":["<file>"]}'
```

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

{{PROBE}}

## The record so far

{{HISTORY}}

This block is capped so the prompt stays affordable, so it may leave attempts
out. Every earlier attempt kept its patch and its record beside `{{SETUP}}`,
under the run directory's round folders: `rounds/r<round>/` for an
improve-a-target run, `rsi/round-<round>/` for an RSI run. A `.patch` file is the
diff that attempt produced; the `.json` beside it holds its measures and the
four lines its agent wrote about what worked and what did not. Read them before you design: they are outside your
worktree, so reading them changes nothing, and repeating an idea that already
failed spends your whole budget for nothing. Take what measured well, leave what
broke the checks.

A line marked `status <name>` other than `completed` was cut off before it
finished. Its `measures` are still the evaluator's, but its `report` is an
unfinished claim, not a validated result. Only the evaluator's `measures` are
evidence that a change worked.

## Read the complete history first

Read every earlier attempt, in full — not only the ones this block carries,
not only the recent rounds, not only the branch you continue from. For each,
read its record and its patch, and for a failure its reason, so you have the
mechanism and the measured result. Trust the measured result over what the
attempt claimed about itself: a report that says a change worked is not
evidence.

## Learn from successes and failures

For every earlier attempt, note the mechanism and how it did. For a failure,
decide which kind it was: a flawed core idea, or a sound idea let down by a
bug, a bad parameter, or a slip. Never repeat the first kind. The second kind
is worth another attempt, but only after you have found the fault in the code
rather than guessed it from the report, and only with a specific fix in hand.

## Do not converge into a local optimum

Read the shape of what has been tried. When most attempts are small variations
of one mechanism and the returns flatten, that place is a local optimum: resist
another small tweak there. Deliberately prefer a structurally different
mechanism, or an untried combination of pieces that already worked, over a
safer marginal refinement. Variety in what you try is worth as much as the next
small gain.

## What counts as a new proposal

A proposal is new when it is a genuinely new mechanism, a new combination of
previously successful pieces, or a targeted fix to a specific fault found
above. It is never a repeat or a rename of something already tried. Implement
it, but do not claim it is correct or beats the target until the frozen setup
has measured it.

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

Bound every command you run. A scorer or a suite that hangs spends the whole
attempt waiting, and the attempt is then recorded as a failure that never
happened. Put `timeout 600` in front of anything that measures.

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
