# Impact

- The punch of a hit: the frames the world freezes on, and the shake after it.
- `context.impact.hit({ weight, at, sound, hold, shake })`. `weight` is 0 to 1 and decides everything else — how long it freezes, how far the camera moves, how low the sound is pitched.
- Weight is curved, not linear: a light hit and a medium one feel close, a killing blow feels like everything. Anything under 0.34 does not freeze at all.
- Hit stop is `context.loop.hold(seconds)` in the kernel: the clock and the schedule keep running, the simulation does not, and the frame still draws. Whole fixed steps only — a fraction of a step is not a step.
- A budget of 0.34s of freeze per second of play stops a screen full of deaths from stopping the game. A lone big hit gets its full pause.
- Shake goes through `context.camera.shake`; sound through `context.play`. Both are optional — with neither loaded, `hit` still freezes and still announces.
- Announces `impact` on the bus with `{ weight, hold, shake, at }`.
- Check with `impact.state`; try one with `impact.hit 0.8`.
