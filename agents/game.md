# Game work

- Read `project/.engine/index.agent.json` first — the compact map.
- Keep one thing in each file.
- Use behaviours for shared traits. Keep behaviour state in `self`.
- Use engine time, random, and timers.
- Ease a value, a point or a colour over time with `context.curve(...)`: your own keys, or a preset such as `'pop'`, `'anticipate'` or `'flash'` with `{ duration, from, to }`. `run see.curve '{"group":"presets"}'` draws every preset; the names are in `engine/curve-presets.js`.
- Prove behaviour with a test or repeatable simulation.
