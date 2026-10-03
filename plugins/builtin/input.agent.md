---
description: Read the keyboard as named actions, so a test drives the same actions a player does. Use when adding controls, rebinding a key, or making a headless test press something.
category: gameplay
---
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
| `pointer()` | the pointer over the game view, `{ x, y, isOver }` in viewport pixels — what `renderer.pickNode` takes |
| `pointAt(x, y)` | put the pointer somewhere by hand, as a test does |

- From a terminal: `run input.press '{"action":"gearAttack"}'` holds an action down in the live tab until `run input.release` with the same action. Use it to hold a moment still for `see.capture`. To pose a field for it, such as `yaw`, use `node bin/engine.mjs setLive <id> <key> <value>`: it changes the running world only and saves nothing, so a lane may use it where `set` is refused. `run input.point '{"x":400,"y":300}'` puts the pointer over the game view in viewport pixels; with `input.press` and `input.release` on a mouse action it drags.

- Mouse buttons over the game view are key codes: `MouseLeft`, `MouseMiddle`, `MouseRight` (never `Mouse1`: the DOM numbers the middle button 1). Bind them like keys.
- While a run plays, a key bound to an action does not also do its browser job (Tab does not move focus).

- `pressed` means this step only. It is cleared on `step:end`.
- A test calls `press` and `release` with a real code from `codes(action)`, so
  the same path runs with no window to type into and rebinding stays covered.
- Keys pressed while an `INPUT` or `TEXTAREA` has focus are ignored, so typing
  a name in a panel does not move the player.
- Every held key is released on window `blur`. A key held while the tab loses
  focus would otherwise stay down for good.

- `holdAction(action, source)` / `releaseAction(action, source)` drive one named control through the recorded input path. Independent sources and physical keys do not release each other. Keep source names stable. Bindings are local to one world.
- Touches on Game UI controls do not press mouse actions. See `game-ui.agent/mobile.md` for the touch kit.
