# Scribe's Bench and first ink art

Open Scribe's Bench from the tavern header, or from the expedition Menu between actions. Return restores the current game screen. Prototype concepts are separate from the company and do not enter campaign loot.

Create Item, Character, Enemy or NPC. Item templates copy any of the 22 catalog pieces, including aura grants and storage. Choose portrait / icon opens a full-width thumbnail grid. Art tab offers 164 images: 86 items and 78 portraits. Filter by kind, group or name, tap a tile, then Save concept. The 128 new images appear first; the original 36 remain available. Any kind of concept can use any image. Art selection changes no gameplay rules, notes or company progress; JSON and local saves keep the image ID.

Edit name, family, description/dialogue and raw notes in Concept. Rules tab adds trigger → target → effect blocks with amount, duration and per-cycle limit. Actor concepts can equip existing items and packs. Advanced auras, conditions, multi-effect actions and exact loadout positions remain editable through JSON.

Save concept writes the device-local library, key `black-bell-concepts-v1`. Up to 50 concepts. Switching to another concept preserves a valid edited concept in the library; invalid edits must be corrected first. Raw editing is labelled unsaved until saved. Corrupt saved data is retained and writes blocked; unavailable storage gives an export warning. Export individual concepts as JSON backups. This is not cloud sync.

AI / JSON → AI brief builds a prompt containing raw notes, the current versioned record and the engine vocabulary. Copy into ChatGPT, paste its JSON response, then Import JSON. Clipboard support varies on Android WebView, so the textarea remains selectable for long-press copy/paste. No network service or API key is connected. Imported code is never executed. Validation uses the production catalog compiler before import, saving and testing. Import produces a new concept; it does not overwrite an existing item definition.

Test runs up to 12 cycles with a private catalog and the same combat resolver. The draft starts at 8 HP (or its maximum if lower), with 3 Hunger and 2 Salvage. The opponent has 18 HP and attacks for 2. An item gets a nearby test dagger; actors use their authored loadout. Trace text reports fired effects. These favourable resource fixtures help inspect effects; results are not power ratings. Social NPCs without combat rules do not attack. Campaign progress is untouched.

## Code

`bell/crafter/model.js`: portable version-1 record, validation, templates, fitting equipment and LLM brief. `preview.js`: isolated combat. `store.js`: storage boundary. `controller.js`: UI actions. `view.js`: engine Game UI kit. `bell/art-library.js`: image IDs, kinds and groups. `bell/art.js`: shared rendering and gallery filtering. Public commands remain `bell.action`; actions are prefixed `craft`. `bell.crafter` reads an isolated snapshot.

A record holds `version,id,kind,name,family,icon,description,notes,definition`. Items use catalog definitions. Actors use `maxHealth,stats,abilities,loadout`; loadout entries are `{type,position}`. Full existing catalog abilities and statuses are available, so imported data can compose primitives without inheritance.

Game UI now includes `kit.textArea`, sharing text events with `textInput`; DOM event reading and form patching support textarea value/focus. It is used for raw notes, descriptions and transferable JSON.

## Art inventory and slicing

The first GPT Image sheet has six columns and six rows at 1254×1254 pixels. It supplies 14 portraits (five crew, eight enemies, one innkeeper) and 22 item icons. Each equal cell remains a 209×209 PNG under `assets/ink`; manifest.json records the rectangle and semantic ID.

Two additional GPT Image sheets each contain 8×8 images at 1254×1254 source pixels. Their cells use rounded equal eighth boundaries, then Lanczos downsampling to exactly 64×64 pixels. The item sheet supplies 64 weapons, armour, nature ingredients, alchemy objects, relics, supplies and tools. The portrait sheet supplies 64 adventurers, townsfolk, outcasts, occultists and creatures. `item-library.json` and `portrait-library.json` record every source rectangle, ID, label and category. New PNGs add 928,265 bytes. Source masters and 512×512 contact sheets are included in the downloadable art kit.

All images keep the original black ground. Scale uniformly with contain; no nine-slicing. Each unique image has one normal state. Labels, panels, selection, damage numbers and hit cues stay in code. These extra pictures are concept choices, not new loot definitions.

The reference sheet and 36 independent images form one kit. `bell/art.js` maps stable IDs to assets. Battle actors use portraits; equipment, reserve, reward cards and tooltips use icons. Unknown portrait identities fall back to a known sprite. The engine Draft board `09 / INK PLACEHOLDERS & SCRIBE BENCH` contains the inventory and workflow.

QC: all three sheets and both 64-pixel contact sheets inspected. All 164 images load in the exported player. Native browser touch selects items and portraits; filtering, search, empty results, two landscape sizes, local reload and JSON preserve choices. This placeholder pass uses rough grayscale engraving and loses some fine hatching at small sizes; silhouettes and text remain the primary identifiers. No additional icon states or baked UI frames. No claim of physical-device testing.
