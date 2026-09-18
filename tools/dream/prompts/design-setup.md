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
- **A task that measures a cost must also check the content it paid for.** If a
  task only counts characters, the cheapest candidate is an empty answer, and the
  run will find it. State what the answer must still contain — the rule sets a
  packet has to carry, the commands a list has to name, the fields a record has
  to keep — and check each one. A cost with no such check is a hole a candidate
  will fall through, and then you have measured nothing but deletion.
- The control must break the target by a literal string replacement in one file,
  and at least one task must then fail. This is what proves the setup can tell a
  working target from a broken one.
- No task may read the score, the weights, or another task's measures.

## The engine will change

The target's candidates may add, rename and delete files, and later runs happen
on a different engine than this one. So a task should measure a mechanism an
agent depends on rather than today's arrangement:

- Prefer a task whose route is a command id, a documented entry point or a
  generated index, because those keep answering after files move.
- When a task must name a path, name the one the target's own change is about —
  and say in `question` what that path is for, so a rename is visibly a change
  to the measurement rather than a silent failure.
- Do not write a task around a file list that exists only because nothing has
  been reorganised yet.

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
