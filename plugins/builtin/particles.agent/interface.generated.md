<!-- Generated from plugins/builtin/particles.js; sha256 63f1c975c6a1332fbea5837d9e1833b417780227d7a2785171db51957021f2c3. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/particles.js). Where the prose below it disagrees, this is the code.

```
  plugin     Particles
  category   visuals
  commands   particles.recent (Bursts recently made)
             particles.state (How many particles are alive)
             particles.effect (Play one named effect)
             particles.clear (Remove every particle)
  arguments  particles.recent: n
  arguments  particles.state: none
  arguments  particles.effect: args
  arguments  particles.clear: none
  context    context.particles
  systems    fixed
  listens    level:loaded
  source     389 lines
```
