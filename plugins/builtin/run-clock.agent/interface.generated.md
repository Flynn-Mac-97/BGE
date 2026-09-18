<!-- Generated from plugins/builtin/run-clock.js; sha256 fd232a2fabb88e1332dd99b62bc46c4d4b6b1deedc04eb6101ebfc99e6c6d28d. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/run-clock.js). Where the prose below it disagrees, this is the code.

```
  plugin     Run Clock
  category   engine
  commands   run.state (Run state)
             run.end (End the run)
  arguments  run.state: none
  arguments  run.end: args
  context    context.runClock
  systems    fixed
  listens    level:loaded
  emits      run:started
             run:ended
  source     176 lines
```
