# Design the setup for one dream run

You are designing the measurement for one dream run. A later phase will generate
candidate versions of the target and score them. Your job is the score itself.

## The target

{{TARGET}}

## What you write

One file: `{{RUN_DIR}}/setup.mjs`. Nothing else. Do not edit the target.

```js
export default {
  name: '<short name>',
  project: '<path to a project the tasks open, relative to the checkout>',
  weights: { <measure>: <cost in score per unit> },
  control: { file: '<path>', find: '<a string in it>', replace: '<a string that breaks it>', why: '<what stops working>' },
  tasks: [
    {
      id: '<short id>',
      question: '<what an agent is asked, in words>',
      async run({ checkout, project, helpers }) {
        // Do the work, or run the route the documentation implies.
        return { pass: true, problem: null, measures: { characters: 1200, processes: 1 } }
      }
    }
  ]
}
```

`run` returns `{ pass, problem, measures }`. `problem` is a sentence naming what
was wrong, and is required when `pass` is false. Every number in `measures` is
summed across tasks, multiplied by its weight, and subtracted from 1, so weights
are the score a whole run of that measure may cost. Weights for milliseconds are
allowed but are not recommended: wall time moves with the machine.

## The helpers

```js
helpers.engineProcess(checkout, project, args, { level, timeout })
  // one headless engine process; args are appended after --headless --project
  // returns { reply, problem, milliseconds }

helpers.packetCharacters(checkout, request)
  // the context packet agent.context would hand an agent
  // returns { characters, milliseconds, error }

helpers.sessionTokens(sessionDirectory)
  // what a harness session spent, summed from its transcript
  // returns { totalTokens, inputTokens, outputTokens, steps } or { error }
```

## Rules the run enforces

- Three to six tasks. Each must run headless with no model and no dev server.
- Every task must pass on the checkout as it is now. A setup whose tasks fail
  before any candidate exists measures nothing.
- At least one task must measure a cost, or the score cannot change.
- The control must break the target by a literal string replacement in one file,
  and at least one task must then fail. This is what proves the setup can tell a
  working target from a broken one.
- No task may read the score, the weights, or another task's measures.

## Before you finish

Run this and make it exit 0:

```
node tools/dream/scoring.mjs --setup {{RUN_DIR}}/setup.mjs
```

A record with `"verdict": "scored"` is a pass; a `"reason"` is the problem to fix.

Then check your control by hand: apply the replacement to a copy of that file
and confirm on paper which task fails and why. Say which task in `control.why`.

## Report

End with one line per task: its id, what it measures, and the numbers the run
just printed. Then one line for the control. Nothing else.
