---
category: gameplay
description: Black Bell's monochrome endless dungeon, earned item choices, scrap caches and grid battle presentation.
triggers: black bell, equipment demo, fight loop, loot, endless battler
---
# Black Bell Prototype

Uses Black Bell Grid and Game UI. `context.blackBell.read()` returns an isolated snapshot. `context.blackBell.action(name,value)` drives the same actions as touch controls. Commands: `bell.read`, `bell.action {action,value}`.

- Plain item blocks: `bell/catalog/items.js`; shared abilities: `bell/catalog/abilities.js`; statuses: `bell/catalog.js`.
- `bell/loop.js` owns room scaling, one-of-three loot, scrap, caches, retry and grid expansion.
- `bell.js` owns cached UI, fixed-clock trace presentation and input locks.
- `bell/inspection.js` derives links and active stats from rule selectors. No item-specific inspection paths.
- `bell/view.js`, `bell/tooltip.js`, `bell/feedback.js`, `assets/ui/theme.css` show the bare black-and-white game.
- Auto continues cycles only inside a room; a win pauses for a reward. Turn mode allows rearranging each cycle. Details/Menu/History hold presentation.
- `tools/playthrough.mjs` earns loot through deterministic simulated playthroughs; no fabricated wins.
- `node --test tests/*.test.mjs` and engine headless `run tests.run` run all regressions.

Draft concepts remain references and do not render during play. No run persistence or new artwork in this pass.
