<!-- Generated from plugins/builtin/run-clock.js; sha256 e28887ee732eb8beb7adf080de2e17014537127c48464d2c8a2e70ddc5e2cc5b. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/run-clock.js). Where the prose below it disagrees, this is the code.

```
  plugin     Run Clock
  category   engine
  commands   run.state (How the run is going)
             run.end (End the run now)
  arguments  run.state: none
  arguments  run.end: args
  context    context.runClock
  systems    fixed
  listens    level:loaded
  emits      run:started
             run:ended
  source     176 lines
```
