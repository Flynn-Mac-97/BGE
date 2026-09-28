# Setting up a character's animations

Do the work; ask the person only what the takes cannot tell you.

1. **Takes.** `animation.library` and the takes' folder. Missing a move the
   game needs? Make it in Kimodo Studio (Kimodo guide), 3 takes a move, then
   copy it (`kimodo.copy`).
2. **Graph.** `run animation.scaffold '{"folder":"motion/<model>","name":"<graph>","skip":[<action takes>]}'`.
   Known names (idle, walk, jog, run, sprint, walk-back, strafe-left/right,
   crouch-idle, crouch-walk, sneak, sneak-crouch, idle-ready, stand-turn-left/right)
   are wired; `unwired` lists the rest. Point the type at the file.
3. **Check.** `run animation.graph`. Fix every problem. Show the person the
   `flowchart` and the `inputs` list; ask which key or AI state sets each input.
4. **Inputs.** Write the type's `update` to set `entity.animationInputs` and
   move at `travelOf`. The demo `animation-demo/types/player.js` is the pattern.
5. **Items and actions.** An item is `models/items/<item>.hold.json` (grip it on
   the Kimodo board, **Save hold**) with `set` naming its set. A set's actions
   play on the upper body; `hold.holding: 0` lets the take swing the item while
   the other hand keeps its grip.
6. **Prove it.** Headless: `rig.load`, `animation.load`, `play`, then simulate
   with inputs and read `animation.state`. Record a `see.gif` for the person.

A new state: add it to `states` with its takes, then a transition in the
right place (priority order: the first that matches wins). A new weapon: a
model, a hold record, a set. Nothing else changes.
