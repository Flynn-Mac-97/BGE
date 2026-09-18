---
name: glass-input
description: Read the keyboard as named actions, so a test drives the same actions a player does. Use when adding controls, rebinding a key, or making a headless test press something.
---
<!-- generated from plugins/builtin/input.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/input.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/input.js"]}'
```

# Keyboard Input

- Game code names an **action**, never a key code, so
  rebinding is a config change rather than a code change.
- Six actions ship: `left` `right` `up` `down` `jump` `fire`. Each maps to a
  list of physical `KeyboardEvent.code` values.
- It is driven from code and from tests.

| verb | answers |
|---|---|
| `held(action)` | is the action down right now |
| `pressed(action)` | did it go down during this fixed step |
| `axis('x')` `axis('y')` | `-1`, `0` or `1` from the four direction actions |
| `press(code)` `release(code)` | drive a **key code**, not an action name |
| `bind(action, codes)` | replace what an action means |
| `actions()` | every action name |
| `codes(action)` | the physical keys one action means |

- `pressed` means this step only. It is cleared on `step:end`.
- A test calls `press` and `release` with a real code from `codes(action)`, so
  the same path runs with no window to type into and rebinding stays covered.
- Keys pressed while an `INPUT` or `TEXTAREA` has focus are ignored, so typing
  a name in a panel does not move the player.
- Every held key is released on window `blur`. A key held while the tab loses
  focus would otherwise stay down for good.
