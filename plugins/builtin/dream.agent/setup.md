# What the design phase writes

One file, `<run>/setup.mjs`:

```js
export default {
  name: 'agent-connection',
  project: 'test/fixture-project',
  objective: 'a higher value is a cheaper agent connection that still answers',
  weights: { processes: 0.02, characters: 0.00001 },
  control: { file: 'bin/engine.mjs', find: '<a line>', replace: '<a line that breaks it>', why: 'what stops working' },
  tasks: [{ id: 'find-player', holdout: false, question: '<what an agent is asked>', async run({ checkout, project, helpers }) { ... } }]
}
```

`run` returns `{ pass, problem, measures }`. `pass` says the candidate is
correct; the numbers in `measures` say how good it is. Every number is summed
across tasks, multiplied by its weight, and subtracted from 1. A positive weight
is a cost, so it is the score a whole run of that measure may cost. A negative
weight is a quality gain: the measure raises the value as it rises, so a target
that maximizes a number uses a negative weight and `objective` says so in words.

The baseline is the target as it stands, and `node tools/dream/scoring.mjs
--setup <run>/setup.mjs` prints its value. A candidate must beat that number.

## The helpers

```js
helpers.engineProcess(checkout, project, args, { level, timeout })
  // one headless engine process; args follow --headless --project
  // { reply, problem, milliseconds }

helpers.packetCharacters(checkout, request)
  // the context packet agent.context would hand an agent
  // { characters, milliseconds, error }

helpers.sessionTokens(sessionDirectory)
  // what a harness session spent, summed from its transcript
  // { totalTokens, inputTokens, outputTokens, steps } or { error }

helpers.browserFrames(checkout, project, { level, size, camera, picture, compareTo, warmSeconds, frames, cycles })
  // the project drawn in a hidden Chrome served from `checkout`, playing
  // { measures: { cpuMs, cpuMsP95, gpuMs, frameMs, drawCalls, triangles, loadSeconds,
  //   heapMB, heapGrowthMB }, difference: { meanDifference, changedShare }, picture, problem }
```

`browserFrames` is the one helper that needs a browser and a GPU. Use it only
when the target is what a frame costs to draw. It takes about a minute per call,
so call it once per task. `cpuMs` and `frameMs` repeat within a few percent;
`gpuMs` does not, so never weight it. `camera` aims the editor's 3D view for the
still picture, taken before play so engine time has not moved; `compareTo`
compares it with a reference PNG and guards against a candidate that draws less.
`cycles` plays and stops that many times and reports `heapGrowthMB`.

When a setup calls `browserFrames`, the candidate prompt already carries
`tools/dream/quick-probe.mjs`: a short exploratory run (a few seconds of warm
play, thirty frames, no heap cycles) that prints the same measures and can write
a Chrome CPU profile with `--profile`. A setup does not need to describe it, and
should not ask a candidate to build a probe script of its own.

Task code runs in the dream process, not in an agent, so it may do anything node
may do. Keep it deterministic: a score that moves between two identical runs is
not a score.

## The rules a run enforces

- Three to six tasks, each headless, no model, no dev server — except a task
  that calls `helpers.browserFrames`, which starts and stops its own.
- Every task passes on the target as it stands.
- At least one task reports a measure, or the score cannot change.
- At least one task is a holdout: different instances, paths or route, so a
  candidate that only fits the discovery cases fails it.
- A failed check scores zero and keeps the attempt. Only a thrown task, or a
  setup whose digest moved, produces no score at all.
- The control breaks the target by one literal replacement in one file, and at
  least one task then fails. `replaceOnce` refuses a string that appears twice,
  so the break is the one the setup named.
- No task reads a score, a weight, or another task's measures.

## Changing a setup

Do not. A run's scores are only comparable against the setup it froze; editing a
task, a check or a weight makes every earlier number meaningless. Write a new
setup, which means a new run.

## A reference setup

`tools/dream/examples/agent-connection.mjs` measures the connection between an
agent and the engine: the context packet it is handed and the route it takes for
five jobs. It is a worked example of the shape, and it scores the checkout as it
stands:

```
node tools/dream/scoring.mjs --setup tools/dream/examples/agent-connection.mjs
```

53,383 packet characters and 5 engine processes, value 0.36617 at the time of
writing. A run designs its own setup; treat this one as a starting point, not a
standard.

The design phase must cover the target's contract, not just its current files.
It should leave room for a new architecture, algorithm, module boundary or
workflow when the target permits one, and test public behavior after such a
change. A lower token count alone is not an improvement: required facts,
commands, links, checks and holdout routes must remain reachable.
