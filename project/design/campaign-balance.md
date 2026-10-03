# Campaign balance pass 1

This pass establishes the eight-room opening chapter. It does not claim a finished long-term campaign or universal item balance. Keep the monochrome prototype and scarce finds while testing decisions.

## Contracts

All three starting recruits can reach a first safe return. Refining a dagger improves a build but must not unlock the only way to damage the boss. Weapon damage remains useful; linked support must offer measurable speed or survival advantages against some threats. Different threats should punish different weaknesses. A fight has a 30-cycle cap, and a viable opening route should not routinely reach it.

## Route

Editable data: `plugins/bell/campaign-rules.js`, `campaignRooms`.

| Room | Enemy | HP | Attack | Pressure |
| --- | --- | --- | --- | --- |
| 1 | Cellar Rat | 4 | 1 | Learn the attack sequence |
| 2 | Grave Robber | 5 | 1 | Slightly longer fight |
| 3 | Venom Leech | 5 | 1 | Applies Poison |
| 4 | Cellar Brute | 8 | 2 | First item and retreat decision |
| 5 | Rusted Sentry | 8 | 2 | Gains 1 guard each cycle |
| 6 | Venom Keeper | 8 | 1 | Applies Poison |
| 7 | Grave Enforcer | 10 | 2 | Attack rises by 1 each cycle |
| 8 | Cellar Warden | 14 | 2 | Gains 1 guard every second cycle; attack rises by 1 every third cycle |

The warden no longer gains 2 guard every cycle. Damage from a basic dagger can get through. Enforcer and warden escalation limits indefinite sustain. Enemy intent is shown while planning; displayed attack includes modifiers.

## Item changes

| Piece | Before | Now | Purpose |
| --- | --- | --- | --- |
| Root Totem | Heal 1 per linked weapon hit | Heal 2 | Reward multiple links and surviving longer fights |
| Storm Totem | Apply 1 Shock per linked weapon | Apply 2 | Make two weapons plus a totem compete with three weapons |
| Notched Hammer | Strip 2 guard, deal 3 | Strip 1 guard, deal 3 | Retain armour role without removing as much protection |
| Reaping Seal | Consume 3 Curse for 9 damage | Consume 2 Curse for 6 damage | Earlier payoff; same damage per stack |
| Salvager Pack | Generate 1 Salvage per contained weapon | Generate 2 | One weapon can fund a Patch Kit action |

No family restrictions, new primitives or hidden combat exceptions. Existing grants, costs, conditions and effects implement every change. Descriptions and Family Lab hints match the values.

## Acquisition and progression

First expedition retains introductory room-four choices and room-eight storage choices. Later expeditions draw from the full catalog, with one unowned partner for the current kit when available. The remaining choices supply variety, prefer unowned equipment, and never duplicate within an offer. `lootPartners` is editable data. This changes item access, not the every-four-room cadence. Twelve-scrap caches remain optional; routine acquisition no longer depends on reaching one.

The expedition records its index when departing. Older active saves without an index retain introductory offers until their next departure. Banked items use current catalog values on a new expedition; an already active saved fight retains its stored stats. No progress reset or save-format migration.

## Repeatable tools

- `node tools/campaign-report.mjs output.json`: 450 earned progression paths across seeds 1, 7, 31, 101 and 997; five recruits, three preferred loot choices, three trait policies and refinement on/off. First clear earns access and coin for locked recruits. No injected XP, equipment or coin. First-fit placement deliberately includes imperfect play. Also runs nine first expeditions and synthetic support probes.
- `tools/balance-bench.mjs`: six explicit three-item builds against burst, attrition, armour and heavy-armour threats. Reports cost, cycles, health and winner. Synthetic probes are not campaign win rates; kits differ in cost and occupied cells.
- Existing `tools/exhaustive-report.mjs`: exact constrained layouts and full fights with both initiatives. `settings.required` focuses a family or a complete chain. Three-item limits are not evidence about larger builds.
- Existing `tools/combo-report.mjs` and `npc.search`: bounded discovery and NPC budget scaling. Holdout opponents must stay separate from training opponents.

## Measured results

117 game tests pass, including support trade-offs, full catalog loot coverage and warden damage/escalation. The tuned family search completed 10,632 constrained layout cases and 63,792 fights without resolver failures; 12 all-item discovery runs added roughly 10,000 training/holdout/ablation fights. The required curse and salvage chains were checked separately.

Final progression report: 450/450 first safe returns, 222/225 unrefined return-expedition clears, 225/225 refined clears, zero timeouts. Eight of nine uninterrupted first-expedition policies cleared. These are deterministic policy outcomes, not human player success probabilities. New loot access contributes to the improvement; do not attribute it all to boss tuning.

The opening route is now forgiving after a banked return. This is an explicit limitation: further chapters, larger enemy inventories, additional objectives and opt-in difficulty are still needed to test long-term accumulation. Do not silently scale enemies to match the player's gear; it would erase earned improvements.

Synthetic examples: lightning uses three cycles versus four for three daggers against attrition; growth ends with more health but loses the burst probe; curse penetrates heavy armour that defeats three daggers; salvage sustains attrition but still needs another offensive tool against armour. These probes protect distinct roles, not numerical equality.
