# Coverage: what a game's UI needs, and where Game UI stands

The loop that grows Game UI stops when every row is `done`. `done` means: a kit function or CSS hook, a headless test, the demo shows it, and a browser check passed.

| Need | Status | How |
|---|---|---|
| Panels, HUD cards, menus | done | `show`, kit layout and controls |
| One stylesheet, tokens, any CSS | done | `assets/ui/theme.css`, `class`, `style` |
| Screen and HUD share the theme | done | palette from tokens |
| World-space labels and bars | done | `anchor`, culling, limit, pruning |
| Game-defined events, any DOM trigger | done | `kit.target`, `action:type` |
| Keyboard focus and menu keys | done | `uiUp`.. `uiBack` |
| Enter and leave animation, phases | done | `data-phase`, `leave: seconds` |
| Animation and effect utilities | done | keyframes, glow, shake, pulse, shine, reduced motion |
| Bars that ease, with a damage trail | done | CSS transition and ghost fill |
| Floating text (damage, pickups) | done | `float`, anchors with a lifetime |
| Drag and drop (inventory, hotbar) | done | `drag`, `drop`, ghost, zones across panels |
| Dialogue and typewriter text | done | `kit.dialogue`, `gameUi.typewriter` |
| Cooldown, ring and radial progress | done | `ring`, `cooldown`, `pips` |
| Notifications stack, context menu | done | `notify`, `menu` |
| Accordion, table, avatar, keybind | done | kit components, `captureKey` |
| Screen effects (flash, vignette, fade, letterbox) | done | `effect`, `clearEffect`, `.ui-fx-<name>` |
| UI sounds (hover, click, focus, open, notify) | done | `--ui-sound-*` tokens, `gameUi.sounds` |
| Gamepad and touch input | done | `Gamepad*` codes, touch drag, coarse-pointer sizes |
| Radial (pie) menu | done | `gameUi.radial`, `pickFocused`, hover focus |
| Rich tooltip that follows the pointer | planned | delayed, placed inside the viewport |
| Long lists and chat logs stay cheap | planned | row culling, a log stuck to the bottom |
| Demo shows all of it | ongoing | `ui-kit-demo` tabs |

Not the kit's job, so a game writes them: what its menus say (text and translation), what a minimap draws, and its own art in `theme.css`.

## Rules for the loop

- One row per tick, in order. Prove it (test and browser), commit, push, then update this table.
- If a tick finds an engine defect, fix it with a regression test before going on.
- Stop when no row is `planned`. Say so, and list what a game still has to write itself.
