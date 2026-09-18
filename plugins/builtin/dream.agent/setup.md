# What the design phase writes

One file, `<run>/setup.mjs`:

```js
export default {
  name: 'agent-connection',
  project: 'test/fixture-project',
  weights: { processes: 0.02, characters: 0.00001 },
  control: { file: 'bin/engine.mjs', find: '<a line>', replace: '<a line that breaks it>', why: 'what stops working' },
  tasks: [{ id: 'find-player', question: '<what an agent is asked>', async run({ checkout, project, helpers }) { ... } }]
}
```

`run` returns `{ pass, problem, measures }`. Every number in `measures` is summed
across tasks, multiplied by its weight, and subtracted from 1. A weight is
therefore the score that a whole run of that measure may cost.

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
```

Task code runs in the dream process, not in an agent, so it may do anything node
may do. Keep it deterministic: a score that moves between two identical runs is
not a score.

## The rules a run enforces

- Three to six tasks, each headless, no model, no dev server.
- Every task passes on the target as it stands.
- At least one task reports a measure, or the score cannot change.
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
