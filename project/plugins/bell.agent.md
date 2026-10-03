---
category: gameplay
description: Black Bell's monochrome tavern, persistent crew, expeditions and grid battles.
triggers: black bell, equipment demo, fight loop, loot, endless battler
---
# Black Bell Prototype

Uses Black Bell Grid and Game UI. `context.blackBell.read()` returns an isolated snapshot. `context.blackBell.action(name,value)` drives the same actions as touch controls. Commands: `bell.read`, `bell.action {action,value}`.

- Plain item blocks: `bell/catalog/items.js`; shared abilities: `bell/catalog/abilities.js`; statuses: `bell/catalog.js`.
- `bell/loop.js` owns provisional room scaling, finds every fourth room, ordinary salvage, 12-scrap caches and retry. `descend` claims ordinary salvage once. Storage attaches as full-height grids at the right edge. `snap` attaches the selected pack after tapping the right-edge slot; dragging is disabled. Attached reserve-list entries select packs for Detach.
- `bell.js` owns cached UI, fixed-clock trace presentation and input locks.
- `bell/connections.js` derives planning highlights, missing-target messages and normal-scan timing warnings from catalog selectors. Numbered items take turns; P marks passives. Extra actions are explicitly excluded from the normal-order guarantee.
- `bell/inspection.js` derives links and active stats from rule selectors. No item-specific inspection paths.
- Views use `bell/art.js` and 164 ink sprites; 128 new 64px choices. Scribe’s Bench: `bell/crafter/`, `bell.crafter` read, `craft*` actions; see `design/scribe-bench.md` for art picker, notes, saves and tests.
- Auto continues cycles only inside a room; a win pauses for a reward. Turn mode allows rearranging each cycle. Details/Menu/History hold presentation.
- Damage presentation holds for 1.5 seconds (2.2 in Slow), labels outgoing/incoming hits, marks attacker and victim, and groups actual HP loss by target. Poison is named as the cause; blocked hits report zero HP loss. Other trace steps retain their short timing.
- `tools/playthrough.mjs` earns loot. `tools/campaign-report.mjs` measures 450 progression paths and support probes; `design/campaign-balance.md` records tuning and limits. Encounters/loot partners: `bell/campaign-rules.js`.
- `node --test tests/*.test.mjs` and engine headless `run tests.run` run all regressions.

Campaign: `bell/campaign.js` owns hires, eight-room expeditions, safe returns, injuries, traits and refinements. `bell/company-save.js` saves stable decisions locally; `bell/tavern-view.js` explains play. See `design/tavern-campaign.md`. Art and concept workflow: `design/scribe-bench.md`.

Family Lab: header/Menu → choose a family. `family`, `practiceReset`, `leaveLab` actions use `bell/family-lab.js`. All22 items in reserve; five preset layouts; fixed armoured dummy; default Turn mode. Reset preserves layout. Return restores dungeon and Auto setting. Family items/abilities: `bell/catalog/families.js`; included in dungeon loot; room4 offers Storm Totem. NPC costs support simulation.
