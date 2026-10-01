# Grid prototype validation — 2026-10-01

The game rules, item catalog and endless dungeon are implemented in the project source. No engine source was changed for this milestone. The live UI remains black and white, with character letters, item footprints, charge markers and numeric combat feedback.

## Results

- 40 checks pass in Node and in the engine's headless Test Runner: placement, timing, shared effects, duration/limits, independent copies, loop protection, rewards, costs, retry, inspection and touch-action locks.
- Three earned-loot simulations (seeds 7, 19 and 41) each cleared 12 rooms. The comparison that ignored finds lost in room 4 after clearing three rooms. Complete room-by-room results: `grid-playthroughs.json`.
- The exported player was driven through six victories to room 7, including real choices and equipment changes. The grid reached five columns. No free-item injection or forced enemy deaths were used in this browser playthrough.
- Planning, compact inspection and full Details fit 844×390, 800×360, 640×360, 1024×768 and 390×844. The five-column grid also passed 844×390, 640×360 and 390×844. Checked grid and tooltip touch targets are at least 44 pixels. No app overflow or tooltip/grid overlap was found in the final pass.
- Browser touch opened an equipped-item tooltip. Preparation consumption, inspection holding, reward buttons, monochrome colours and absence of live art were checked. No uncaught runtime exceptions were observed.
- Android APK export and v2/v3 signature verification pass. Package ID is `com.engine.blackbellprototype`; landscape activity is declared. Packaged controller, core resolver and stylesheet match the tested source.

The APK has not been run on a physical Android device or emulator. These checks establish progression and UI behaviour, not subjective fun or device performance. The next useful feedback is whether choosing and placing a new item feels rewarding, and whether the first poison enemy explains why cleansing matters.

## Known limits

The broad engine `check` still reports the pre-existing Android exporter formatting/import-boundary problems and kernel structure-budget failure. It reports no new project warning in this pass. These were not changed as part of game work.

Run saves, item sockets, multi-character inventories and item-driven storage modules are not implemented. Room 4 and room 7 grant right-side columns as a provisional recovered-pack reward. Item balance and enemy scaling are prototype values. The automated placement search is a limited local search; it is neither an optimal-play proof nor a substitute for a person playing.

## Artifacts

- APK: `/workspace/artifacts/black-bell-grid-prototype.apk` (15,233,921 bytes).
- SHA256: `7397bb2afa505349922a6e91307532a946d83740299c7d68b5dea171b2338806`.
- Screens: `/workspace/artifacts/black-bell-grid-{start,loot,tooltip,room-seven}.png`.
- Static player: `/workspace/BGE/agent-runs/black-bell-items/grid-www/`.
- Engine checks and browser logs: `/workspace/BGE/agent-runs/black-bell-items/grid-*`.

The browser review lane was stopped. The supervised project dev server remains on port 5182. No site or Git remote was published.
