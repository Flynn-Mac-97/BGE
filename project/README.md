# Black Bell — grid gameplay prototype

A bare black-and-white landscape auto-battler. Start with a nameless recruit and one rusty dagger. Defeat rooms, gather salvage and earn one item choice every fourth room. Fifteen item definitions combine eight shared effect types. No concept art appears during play.

## Play

Tap a reserve item, then its top-left grid cell to equip it. Tap any occupied cell to inspect. Move explicitly starts a move; Stow returns an item to reserve. Invalid moves preserve the layout. During planning, selecting equipped gear highlights connected items automatically. Numbers show normal turn order; P marks passive listeners and auras. Each item's strip states its effect with live numbers: START, END and HIT name the trigger, and an inverted strip means a neighbour or modifier changed the number. Badges on shared edges point from the item that feeds to the one it feeds, with the amount. During a fight, the item that just acted shows what it did. Dashed connections and an exclamation mark warn when preparation comes after the weapon’s normal turn. Missing targets explain which neighbour is required. Details shows connection direction, conditional reactions and the extra-action exception; these are placement hints, not promised combat outcomes. Details holds combat and shows active bonuses, rule timing, remaining combat uses and selectable grid links.

Fight starts automatic cycles within the current room. Turn off Auto to stop after each cycle and rearrange. Damage pauses for 1.1 seconds (1.8 in Slow). The attacking item stays highlighted; the victim shows a large damage number, and a source → target readout shows HP before and after. Poison and blocked damage are identified separately. Pause, Step and Slow control presentation. Menu and History also hold the turn. Winning always pauses for a reward; a choice never starts the next fight automatically.

The first find offers Venom Vial, Whetstone or Herbal Salve. Place venom at cell 1, to the left of the starting dagger at cell 2. The vial prepares the dagger before its strike. Moving that vial to cell 4 prepares too late: the unused coating expires. Other finds include shields, healing, auras, Hunger generation/spending, cleansing and an extra-attack chime. Copies are independent instances.

Ordinary rooms grant one scrap and three health after tapping Gather salvage & descend. Every fourth room offers one of three items instead, with the same scrap and recovery. A cache costs twelve scrap and grants one item without advancing the room or refunding scrap. Salvaging spare gear grants one scrap; your last weapon is protected. Room eight offers a pouch, pack or sword. These acquisition intervals and prices are provisional.

Patched Pouch is an attached 1×3 container; Worn Pack is 2×3. Tap a reserve pack, then tap the + slot on the right. This slot stays outside the scrolling grid; pack dragging is disabled. The pack itself occupies no equipment cells: items go inside its outlined region. Further packs attach to the new right edge. Items across joins remain neighbours. To detach, empty the outermost pack, select its attached entry and tap Detach. Inner packs remain attached until packs to their right are removed; coordinates never shift silently. No room number grants slots. Wider grids scroll horizontally with touch cells at least 44 pixels wide. Sockets for gems remain future work.

Enemy numbers have only a provisional slower growth adjustment to accommodate fewer rewards. Detailed scaling and balance are deferred for collaborative design. Defeat allows retry with the same gear and room-entry health. A fight with no result after thirty cycles ends as a stalled defeat.

## Source and tests

- `plugins/grid-game/`: serializable grid, selectors, effects, catalog validation and bounded event queue.
- `plugins/bell/catalog/items.js`: item data; `catalog/abilities.js`: reusable ability blocks; `catalog.js`: statuses.
- `plugins/bell/loop.js`: room progression, loot and scrap economy.
- `plugins/bell.js`: engine input/time adapter and public read/action API.
- `plugins/bell/view.js`, `tooltip.js`, `inspection.js`, `feedback.js`, `assets/ui/theme.css`: prototype presentation.
- [Rule authoring contract](design/grid-rules.md).

Run `node --test tests/*.test.mjs`, or from the engine checkout:

```sh
node bin/engine.mjs --project project --headless run tests.run
```

`node tools/playthrough.mjs` tests earned-loot builds with deterministic seeds and compares them with ignoring gear. It does not grant free items or force combat victories. The public commands are `bell.read`, `bell.action {action,value}`, `gridGame.vocabulary`, `gridGame.validate` and `gridGame.resolve`.

## Build and continuity

```sh
node bin/engine.mjs --project project export --android --out release/black-bell-grid-prototype.apk
```

Android package: `com.engine.blackbellprototype`; landscape requested. WebGPU is preferred with automatic WebGL 2 fallback. The APK packages the engine player in its existing Android WebView host.

This game is bundled in the BGE repository under `project/`. Its source was imported from Black Bell commit `035c351`. Engine and game changes now share the engine Git history. Run engine commands below from the BGE checkout root; run direct Node project tests from `project/`. Run state resets on application reload; persistent save/load is not implemented. Balance and item numbers are provisional.

## Draft interaction boards

Four editable boards are saved in the engine Draft panel: Place Items, Coat → Strike → React, Timing, and Item Tooltip. They propose touch feedback and tooltips using the current combat rules. They do not change the playable prototype.

The saved documents are in `.engine/systems/draft-*.json`. Portable plan copies are tracked in `design/drafts/`. To restore a missing board, pass its JSON contents to `draft.plan` through the engine CLI, with this project selected and review lanes stopped. The plan includes its document ID. After editing a board in the panel, refresh the tracked copy using `draft.read`.

Reviewed screen captures: `/workspace/artifacts/black-bell-draft-{placement,combo,timing,tooltip}.png`.


## Archived visual direction

Gothic tooltip, landscape and family-emblem concepts stay in `assets/concepts/` and the saved Draft boards. They are references for later art work. The writing handoff under `design/writing-handoff/` predates these gameplay changes; this README and the rule contract describe the current prototype.

## NPC authoring lab

[Actor recipes and cheap simulation](design/npc-authoring.md) describes `npc.generate`, `npc.validate`, `npc.simulate`, `npc.evaluate` and `npc.search`. The lab uses shared items/effects on independent actor inventories, with seeded loadouts, explicit reference kits and both initiatives. It is separate from the current playable encounter list and difficulty curve.

## Placeholder art library

Scribe’s Bench → Choose portrait / icon (or Art tab) browses 164 thumbnails. Two new 8×8 sheets add 64 item icons and 64 portraits at 64×64 pixels each. Filter by type, group or name; tap an image and Save concept. The new art appears first. These choices are separate from gameplay definitions. [Authoring and art details](design/scribe-bench.md).
