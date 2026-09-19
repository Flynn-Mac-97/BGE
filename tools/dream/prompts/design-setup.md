# Design the fixed evaluator for one dream run

You are writing the evaluator for one discovery problem. A later phase generates
candidate versions of the target and scores them against this file, and this file
never changes afterwards. Your job is the score itself: what a solution must be
correct about, and what makes one correct solution better than another.

The paper's rule is the one to follow. The evaluator returns a quality: a larger
number is a better solution. A candidate that fails a correctness check scores
zero and is still an evaluated attempt, so a search policy can repair it rather
than treat the branch as dead. Only a broken harness produced no score.

## The target

{{TARGET}}

## What you write

One file: `{{RUN_DIR}}/setup.mjs`. Nothing else. Do not edit the target.

```js
export default {
  name: '<short name>',
  project: '<path to a project the tasks open, relative to the checkout>',
  objective: '<what a higher value means, in one sentence>',
  weights: { <measure>: <score per unit> },
  control: { file: '<path>', find: '<a string in it>', replace: '<a string that breaks it>', why: '<what stops working>' },
  tasks: [
    {
      id: '<short id>',
      holdout: false,
      question: '<what an agent is asked, in words>',
      async run({ checkout, project, helpers }) {
        // Do the work, or run the route the documentation implies.
        return { pass: true, problem: null, measures: { <name>: <number> } }
      }
    }
  ]
}
```

`run` returns `{ pass, problem, measures }`. `pass` says the candidate is
correct; the numbers in `measures` say how good it is. `problem` names what was
wrong and is required when `pass` is false.

## The objective

- A weight is subtracted from 1, so a positive weight is a cost: lower is better.
  A negative weight is a quality gain: higher is better. A target whose aim is to
  maximize a number uses a negative weight, and `objective` says so in words.
- Weight the objective, not a proxy. A candidate must not be able to raise the
  value by deleting the work the check requires.
- `node tools/dream/scoring.mjs --setup {{RUN_DIR}}/setup.mjs` prints the value of
  the target as it stands. That number is the baseline every candidate has to
  beat.

## The evaluator

- Three to six tasks. Each runs headless with no model and no dev server, except
  a task that must price drawing on a graphics card: it calls
  `helpers.browserFrames(checkout, project, options)`, which starts its own dev
  server and hidden Chrome from the candidate's checkout and stops them after.
  One call takes about a minute. Score `cpuMs` and `frameMs`; `gpuMs` moves by
  several times between identical runs, so report it and never weight it. Pass
  `compareTo` with a reference PNG and fail a `difference.meanDifference` above
  a small bound, or a candidate wins by drawing less.
- Every task must pass on the checkout as it is now. A setup whose tasks fail
  before any candidate exists measures nothing.
- At least one task carries a measure, or the value cannot change.
- A task that measures a cost must also check the content it paid for. If a task
  only counts, the cheapest candidate is an empty answer. State what the answer
  must still contain and check each one.
- Include at least one task with `holdout: true`: different instances, paths, or a
  different route, so a candidate that only fits the discovery cases fails it.
  Discovery cases are the ones the candidate is written against; the holdout is
  the generalization test, as the paper's held-out datasets are.
- Check retention and discoverability, not only presence. Required facts,
  commands, links, checks, and detail files must remain reachable.
- If the target changes architecture, test public behavior through its interface
  and test a boundary that would fail under a shallow rewrite.
- The control must break the target by one literal string replacement in one
  file, and at least one task must then fail. This is what proves the setup can
  tell a working target from a broken one.
- No task may read the score, the weights, or another task's measures.
- Return `pass: false` for a wrong answer. Never throw for one: the run records a
  failed check as a score of zero and keeps the attempt, but a throw is a broken
  harness and produces no score at all.

## The engine will change

The target's candidates may add, rename and delete files, and later runs happen
on a different engine than this one. So a task should measure a mechanism an
agent depends on rather than today's arrangement:

- Prefer a task whose route is a command id, a documented entry point or a
  generated index, because those keep answering after files move.
- When a task must name a path, name the one the target's own change is about.
- Do not write a task around a file list that exists only because nothing has
  been reorganised yet.
- Name the contract separately from its current implementation. Say what must be
  true after a refactor, which routes stay valid, and which old files may vanish.

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
