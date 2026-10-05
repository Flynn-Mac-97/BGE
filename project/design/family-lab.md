# Family Lab

Open Family Lab from the game header or Menu, then choose a kit. This enters a separate practice session. Return to dungeon in Menu restores the previous journey and Auto setting. Entering is blocked while dungeon combat is resolving.

All22 catalog items are owned in practice. Seven new test items complement the existing pieces. Tap a reserve item, then a grid cell; packs use the existing right-edge attachment slot. Mix any families. Reset test restores health, resources and charges while preserving the current arrangement. Choosing another family restores that preset and the complete item shelf. Practice has no loot, scrap farming or salvage deletion.

| Family | Starting kit | Try |
| --- | --- | --- |
| Growth | Root Totem, Dagger, Hammer, Salve, Living Sprig | Move the totem away from a weapon and watch its on-hit healing disappear. |
| Combat | Whetstone, Notched Hammer, Torn Banner, Iron Sword | Swap the whetstone behind its target; compare preparation timing and guard-breaking. |
| Scholarship & Alchemy | Venom Vial, Dagger, Storm Totem, Hammer, Echo Chime | Compare Poison with Shock, then use Echo's extra hammer action. |
| Hunger & Curses | Curse Idol, Reaping Seal, Dagger, Hungry Tooth, Blood Cup, Banner | Watch Curse reach3 and pay out; Hunger funds healing. Swap Idol/Seal to change cycle-end timing. |
| Scavenging & Fortune | Salvager Pack, Dagger inside, Patch Kit, Hammer | Move the dagger out of the pack; Salvage production stops. Patch Kit spends2 for4 Guard. |

The five-column, three-row base grid gives room to experiment. The scavenging pack adds a sixth column. One shared dummy has60HP, gains2Guard each cycle and attacks for2 after cycle-end effects. Your recruit begins at20/30HP so healing can be observed. These are test fixtures, not the dungeon scaling algorithm.

Turn mode is the default: Fight, watch a full cycle, rearrange, then Next Cycle. Enable Auto for a complete fight. Pause/Step, Slow, History, Details and link highlights use the existing controls. Shock and Curse stacks and combat Salvage are visible. All five presets are tested to defeat the dummy and execute their main family interaction.

All family items are included in normal dungeon reward and cache pools. LOOT-03 shows a visible build label in the header. Every item shows its power family as a small white emblem on grid tiles and reserve entries, and beside the item's name on the tooltip, reward cards and Descent level-up cards. There is no family text. The UI stays monochrome. `plugins/bell/power-families.js` holds the five families; an item belongs to the first family its tags name. Emblems are 96px copies of `assets/concepts/family-icons/` in `assets/ui/families/`. Room4 includes Storm Totem. Every later random find and cache guarantees one family item, preferring an unowned type; all offers still contain three distinct options. Room8 remains the storage choice and the item-find interval is unchanged. NPC Lab has provisional costs for all22 items, allowing explicit simulation pools. No probability or fortune mechanic has been invented: the Scavenging & Fortune kit currently explores collection and storage.

Authoring: plugins/bell/catalog/families.js. Presets and practice setup: plugins/bell/family-lab.js. Tests: tests/family-lab.test.mjs. The existing APK is not rebuilt by this source change.
