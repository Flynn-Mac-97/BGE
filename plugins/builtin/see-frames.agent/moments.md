# A moment in time

Simulate to the moment, then look — one call, one world, deterministic:

```sh
node bin/engine.mjs --headless --project <p> script \
  '[["simulate",30],["run","see.diff",{"steps":60}],["run","see.sketch",{"name":"at-30s"}]]'
```

In the browser drive time with `simulate`, never by waiting. If time will
not advance, read `snapshot`; `paused` names who holds the clock.
