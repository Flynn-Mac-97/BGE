# Black Bell — grid gameplay prototype

A bare black-and-white landscape auto-battler. Start with a nameless recruit and one rusty dagger. Defeat a room, choose one of three finds, rearrange the inventory and descend. Thirteen item definitions combine eight shared effect types. No concept art appears during play.

## Play

Tap a reserve item, then its top-left grid cell to equip it. Tap any occupied cell to inspect. Move explicitly starts a move; Stow returns an item to reserve. Invalid moves preserve the layout. Details holds combat and shows active bonuses, rule timing, remaining combat uses and selectable grid links.

Fight starts automatic cycles within the current room. Turn off Auto to stop after each cycle and rearrange. Pause, Step and Slow control presentation. Menu and History also hold the turn. Winning always pauses for a reward; a choice never starts the next fight automatically.

The first find offers Venom Vial, Whetstone or Herbal Salve. Place venom at cell 1, to the left of the starting dagger at cell 2. The vial prepares the dagger before its strike. Moving that vial to cell 4 prepares too late: the unused coating expires. Other finds include shields, healing, auras, Hunger generation/spending, cleansing and an extra-attack chime. Copies are independent instances.

Room rewards grant one item, one scrap from leftovers and three health, capped at twelve. Every three scrap buys another one-of-three cache. Salvaging spare gear grants one scrap; your last weapon is protected. Cache leftovers grant no scrap. After rooms 3 and 6 a recovered pack adds a full-height grid column, up to five columns. This is a depth reward; storage items and sockets remain future modules.

Three enemy profiles rotate: rat, grave robber and poison leech. Health grows by three each room and attack increases every three rooms. There is no fixed final room. Defeat allows retry with the same gear and the health you had when entering that room; a new run starts over. A fight with no result after thirty cycles ends as a stalled defeat, so a healing-only layout cannot trap the test session.

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
