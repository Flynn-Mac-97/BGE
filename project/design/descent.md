# The Descent: endless run

The main mode of Black Bell. One crew member goes down an endless stair until
they die. Their gear grows stronger on the way down. The Bells they earn buy
permanent upgrades at the Bell Tower, so the next run goes deeper.

## The hook in one line

Every floor gives Embers. A full Ember bar lets you choose one of three
upgrades. Five levels plus the right neighbour on the grid turns an item into
its evolved form. Enemies grow every floor, without end.

## The loop, by time scale

| Scale | What happens | Why it pulls |
| --- | --- | --- |
| Seconds | A floor is one auto-battle. Items fire in grid order; numbers pop on the grid. | Your build visibly does things. |
| About a minute | The Ember bar fills. Choose 1 of 3 cards; sometimes (30%) you also train one item +1 level. An item's surge levels multiply all its numbers. | Constant small choices, and lucky ones you cannot count on. |
| Every boss | The travelling Peddler visits. Spend Coin on wares from every family and one evolved item; sell what you no longer need. | You steer the build: buy the piece you are missing. |
| About five minutes | Every 5th floor is an elite, and every 10th a boss. Both drop a chest. A chest evolves an eligible item, or rolls free level-ups: usually 1 (elite) or 3 (boss), sometimes 5. | A goal you can see coming and plan the grid for. |
| A run | Depth is the score. New crew unlock at depth 10, 15 and 25. | "One more floor." |
| Between runs | Bells buy Bell Tower ranks, and every item you used gains mastery. Vigor, Might, Kindling and Fortune never cap. | You hit a wall, prestige, and break it next time. |

## Rules

- **Items level without limit.** Every number an item has is a stat. At level L each stat is `base × (1 + growth × (L − 1))`, times `surge.share` (1.5) for each surge level reached (2, 5, 9, 14, 20, 27), rounded. The card for a surge level says SURGE. `growth` and `surge` are in `plugins/bell/descent/tuning.js`.
- **No duplicate drops.** A card for an item you own is a level-up. New items are rare: their weight falls with every item you own, and there is a hard cap.
- **Evolution.** An item at its recipe's level, touching its partner item on the grid, evolves at the next chest. It keeps its level, gains a new name, a new ability and the evolved border. Recipes are in `descent/evolutions.js`.
- **Health carries over.** The recruit recovers a share of health after each floor, and each level-up raises max health a little.
- **Rerolls.** A run starts with a few rerolls; each redraws the current cards.
- **Death.** The run ends at once. Bells: 1 per floor cleared, more for elites and bosses.
- **Stall.** A fight with no winner after the cycle cap is a defeat. Every foe tires: from cycle 24 it loses 10% of its health each cycle, through guard (`tuning.enemy.tire`, `tireAbility` in `enemies.js`). It is a last resort before the cap, not the usual way a fight ends.
- **Poison fades.** At each cycle end Poison deals its stacks through guard, then loses 1 stack and a fifth of the rest. A steady stream of Poison levels off at about five times what is added each cycle, so it stays strong against guard but no longer grows for the whole fight.

## Scaling

Enemy health and damage grow by a fixed factor every floor (exponential). Gauntlet pass: health grows 1.17 per floor from a ×3 base, damage 1.07 per floor from ×1.5 (elite ×0.8, boss ×1), so fights last about 4 cycles instead of 2 and one hit no longer kills; Heavy Blow and the Cellar Rat are the floor-1 to 5 hazards to watch. Item
levels grow linearly, and evolutions and synergies multiply them, so a good
build stays ahead for a long time and then is overrun. Elites and bosses
multiply health. All factors are in `tuning.js`. `node tools/descent-sim.mjs`
plays seeded runs with a simple bot and prints the depths reached, then, for
each floor kind, the average fight length, the share of health lost and the
deaths; use it after any change to the numbers.

The kind multipliers aim for a curve, not walls: normal floors cost about
15% of health, elites about 30%, bosses about 60%, and bosses cause a little
over half of all deaths. The numbers are set against the test-bout bot
(`tools/descent-bot.mjs`), which plays well, so a person who plans less goes
less deep. After the Build Lab pass, elites and bosses were eased (elite ×1.2 health,
×0.8 damage; boss ×1.45, ×1): median floor 18–22 by crew. Before it, with
training and the Peddler: median floor 20 for every crew; normal floors cost 10–12%, elites 25–38%, bosses 46–56%;
bosses cause 87 of 160 deaths; about one evolution per run.

From level 3, an item that can evolve shows ⇄ on its badge, and the list under
the reserve says what it still needs: find the partner, touch it, reach level
5, or wait for the next chest.

Every power family can drop. Scholarship (Purifying Salt, Echo Chime, Storm
Totem), Hunger (Ward Tooth, Curse Idol, Reaping Seal) and Scavenging (Salvager
Pack, Patch Kit, Worn Pack) joined the pool alongside Root Totem; their fixed
numbers became stats, so they grow with level like everything else (level 1 is
unchanged). A payoff that does nothing alone is offered only once the run owns
what feeds it: `poolNeeds` in `pool.js` (Reaping Seal needs Curse Idol, Patch
Kit needs Salvager Pack). Packs attach at the right edge in a run as in the
Family Lab, and are placed first when a floor starts, so what is stored inside
them keeps its place. New evolutions: Storm Totem + Echo Chime → Tempest Totem,
Curse Idol + Reaping Seal → Hex Idol, Patch Kit + Salvager Pack → Scrap
Crossbow (a weapon, so it can sit inside the pack and fund its own shots).

`tools/descent-sim.mjs` plays with the bot in `tools/descent-bot.mjs`, which
plans by trying: each candidate cell gets a two-cycle test bout against
the floor's enemy (which cannot die), scored as damage dealt minus health lost.
A card, a training level or a ware gets an eight-cycle bout instead, longer than
a boss fight, so items that stack or grow are valued for the whole fight.
It places each new item in its best cell, moves items that add nothing where
they are, values a cell touching an evolution partner a quarter more, and adds
a bonus for cards that complete something it owns. The older bot, which placed
by evolution adjacency alone, made the wider pool look weaker than it is.

A new item that completes something the run owns (an evolution partner, or the
payoff a feeder unlocks) is `cards.synergyWeight` times as likely to be offered,
so builds come together.

Before the enemy retune, this bot reached median floor 23 (Rook), 30 (Nettle)
and 30 (Pip); the older bot on the old pool reached 18, 20 and 25. 0.63 evolutions a run, two thirds
of them Widow's Fang: every crew starts with the Rusty Dagger and Venom Vial is
a common drop, so the poison evolution is the easiest one to reach.

Consumables have their own card weight, so they keep turning up however many
items the run owns.

A level-up draw holds at most one level card, and its last card is always new
(an item, a consumable or a tome) while any are left. Level cards weigh less
than they did, and new items fall off more slowly as the run owns more. Before
this, about 70% of all cards offered were level cards and a run saw about 10
of the 21 new items; now under half are level cards and a run sees about 14.

## Enemy threats and family powers

Every enemy has threats that ask a build for a different answer
(`descent/enemies.js`, `enemyTraits`): Heavy Blow (a huge hit every 3rd cycle:
Sap, Smoke, guard), Plated (thick guard each cycle: strip it or go through it),
Purifier (washes off Poison, Bleed, Burn, Shock and Curse: hit it directly),
Swarm (three extra small blows: thorns and hit-triggered items), Regrowth
(heals a lot: Bleed, Curse, burst) and Spiked (hurts you when hit: few big
hits). Normal enemies have one, elites two, bosses three; they show as chips
on the enemy's nameplate and in the floor's opening line.

Family powers (`descent/family-powers.js`): with 3 items of one family on the
grid its power is on; with 5 it applies twice. Arms Drill (Combat): weapons
+25% damage. Living Bark (Growth): every heal also gives that much guard.
Resonance (Scholarship): each status stack put on the foe also deals 1 damage
through guard. Blood Frenzy (Hunger): each hit you take feeds you 1 Hunger (up to 3 a cycle), and below half health weapons +40% damage.
Lucky Haul (Scavenging): a d6 of Salvage each cycle, and weapons +1 damage per
2 Salvage. They are recruit abilities with a `tagCountAtLeast` condition, so
moving a piece off the grid turns its power off. The list beside the grid shows
each family's count. Pip starts with Scholarship pieces and Moss with
Scavenging ones, so not every run starts in Combat or Growth. With the bot, 139
of 180 final builds reach a family power, across all five families.

## Build Lab: which builds are strongest, and why

`node tools/build-lab.mjs run [evaluations]` searches for the strongest builds
and writes `agent-runs/build-lab/report.md`; `report` rebuilds the report from
the last run. A build is 7 base items at level 8, laid out by the test-bout bot.
It fights a gauntlet (a plain foe, one foe per threat, a three-threat boss),
climbing floors 14–68 against each until it loses; its score is the mean depth.
Six searches run in parallel: one open, and one per family (at least 3 of it),
each a hill climb from four random starts. The report holds:

- the best build per search and its share of the overall best (viability);
- a threat matrix: each best build's depth against each foe;
- removal tests: what each best build loses without each item;
- pair synergy over every build tried: the mean score with both items, minus
  what each brings alone, over the mean with neither;
- item use in the top tenth of builds, and the items least used;
- balance metrics with targets: weakest family at least 90% of the best, no
  item in more than 40% of top builds, the hardest threat at 75–90% of plain.

Tuning passes with it: Throwing Knife opens with one throw and is 1×2;
Tower Shield and Penitent Chains give less guard; Iron Sword hits for 4;
Honeycomb stores a fixed 2 Honey; dice can grow with an item stat
(`{roll, scaleStat}`), so Lucky Purse, Lockpicks, Grave Shovel and Lucky Quiver
keep up with depth; Heavy Blow lands every 2nd cycle; Purifier cleans on its
turn, before statuses tick; Plated, Purifier and Regrowth hit harder and
Spiked softer; under-used Hunger, poison and support pieces were raised.
After them: every family's best is 93% or more of the best; the most-used item
(Flail) is in 46% of top builds; the hardest threat sits at 90% of plain; and
each family's best build has a different weak spot (Growth and Hunger to Heavy
Blow, Scholarship to Swarm, Regrowth and Spiked, Combat to Heavy Blow).

## Prestige: Bells, the endless Tower and mastery

Bells for a won floor grow with depth (`bells.growth` per floor), and a floor
deeper than your best pays a record bonus of `bells.record` × floor, so
pushing your wall is the best farm. Vigor (+6% max health), Might (+4.5% to
every item number), Kindling (+9% Embers) and Fortune (+12% Coin) are endless:
rank r costs baseCost × 1.12^r. The unlock upgrades keep their caps. Item
mastery (`descent/mastery.js`): each floor won with an item on the grid gives
that item type 1 xp; level L needs 10 × L × (L + 1) / 2 xp; each level adds 5%
to the item's numbers in every run, shown as ✦ on the grid badge.

`node tools/descent-prestige.mjs [runs] [crew]` plays runs in a row on one
profile, spending Bells on the cheapest rank after each. Rook: 20, 26, 28, 30,
30, 32, 35, 35, 40, 38, 40, then about 40. Nettle: 11, 22, 30, 38, then 30–40.
The floor 40 boss is the wall after about ten runs.

## Training and the Peddler

A level-up is a card. With chance `tuning.trainChance` (30%) it is a lucky one:
you also train one owned item +1 level (phase `train`). Training is aimed, so a
build can be pushed where it is weak, but a run cannot count on it.

Every floor gives Coin (`tuning.coin`: 1, 3 for an elite, 8 for a boss). After
each boss, once the chest and level-ups are done, the travelling Peddler visits
(phase `peddler`). His stock is one item from each power family the run can
still take, one evolved item (sold nowhere else) and one consumable; wares come
at level 1 + 2 per boss beaten. Prices are in `tuning.peddler`. He also buys:
an owned item sells for 2 + its level. `descent/peddler.js` holds the stock,
prices, buying and selling.

## Data, by file

| File | Holds |
| --- | --- |
| `plugins/bell/descent/tuning.js` | Every number: growth, scaling, Ember curve, card weights, chest cadence, Bells. |
| `plugins/bell/descent/pool.js` | Which items can drop, and the starting crew and their kits. |
| `plugins/bell/descent/enemies.js` | Enemy bands by depth, with their lines of narration. |
| `plugins/bell/descent/evolutions.js` | Recipes and the evolved items. |
| `plugins/bell/descent/tower.js` | Bell Tower upgrades: capped ranks and endless ones, and their costs. |
| `plugins/bell/descent/mastery.js` | Item mastery: xp per floor, levels and their bonus. |
| `plugins/bell/descent/run.js` | The run: floors, Embers, cards, training, chests, evolution, the Peddler's visit, death. Plain records in and out. |
| `plugins/bell/descent/peddler.js` | The Peddler's stock, prices, buying and selling. |
| `plugins/bell/descent/profile-save.js` | The saved profile: Bells, best depth, tower ranks, the active run. |
| `plugins/bell/descent/view.js` | The hub, the run header, cards, chest and summary screens. |
| `plugins/bell/descent/consumables.js` | Consumable items, their tap abilities, charges and grid labels. |
| `plugins/bell/descent/forge.js` | Forge parts (WHEN, DO, TO, POWER), their costs, and how a record becomes an item and an ability. |
| `plugins/bell/descent/forge-view.js` | The Forge screen. |
| `plugins/bell/duel/duel-rules.js` | Duel Pit rule cards and their options. |
| `plugins/bell/duel/duel.js` | A same-screen duel: draft in turn, pass the phone, fight, rate. |
| `plugins/bell/duel/view.js` | Duel Pit screens: rules and fun log, draft panel, handoff, result. |
| `plugins/bell/descent/battle-stage.js` | The battle stage: framed portraits, nameplates with HP and Embers, the battle text box, and the per-step effects. Styles are in `assets/ui/theme.css`. |

To add an item to the run, add it to the catalog, then to `pool.js`. To add an
evolution, add one recipe and one item record in `evolutions.js`. No logic
changes are needed for either.

## The Forge

At the Lantern, spend Bells to make an item from four parts: WHEN it acts,
what it DOES, TO whom, and its POWER. The price is `(when + do) × power`.
A forged item is 1×1, joins the card pool of every new run, and can stand on
the Duel Pit shelf. The profile holds at most 12. Records are saved as parts,
not as items, so changing a part's numbers in `forge.js` changes every forged
item.

## The Duel Pit

Two players share one screen. Each rule card cycles through its options:
items each, item level, grid columns, hero health, shelf size, evolved items,
forged items and sudden death. Player 1 drafts from the shelf, passes the
phone, then Player 2 drafts. The builds fight on two separate grids; the board
shows P1's grid on the left and P2's on the right. After each fight the
players rate it Dull, OK or Great. The profile keeps the last 60 ratings, and
the rules screen lists the rule options with the best average fun.

## Consumables

Mending Draught, Bramble Ward, Rot Bloom, Whet Oil and Smoke Flask drop as
new-item cards. Each sits on the grid like any item and has charges (Bramble
Ward 2, the rest 1). Tap one during a floor, then Use: it is readied, and it
acts at the start of the next cycle. A tap the floor never used gives its
charge back. Every chest refills all charges. Levels raise their numbers, not
their charges. They never stand on the Duel Pit shelf. The sim bot taps them
on elites and bosses, and taps the healers below half health.

## Tomes

A level-up draw can hold one tome card in place of an item or level card.
A Tome of Vigor adds 6 max health for the run; a Tome of Might adds 1 to
every nonzero number on all gear, including gear found later. Tomes stack.
Bells are never spent in a run: every run brings all its Bells home.

## Offers and the Peddler (gauntlet pass)

A new item is `synergyWeight` (6) times as likely when it completes something owned, `newFamilyWeight` (2) times when the run owns nothing of its family, and `repeatFamilyWeight` (0.25) times when the same draw already offers its family, so a draw shows different families and crews leave their kit family. The Peddler's stock is drawn when he arrives, after the level-ups, so he never sells a type the run has just taken.

Threat numbers after the floor-68 ruler (stat at floor 1, grown like damage): Heavy Blow 1.8 every 2nd cycle, Plated 10, Regrowth 8, Swarm 0.25, Spiked 0.45. Heavy Blow at 5 killed even the best builds in one hit by floors 40+, so every family lost one step to it; at 1.8 the best family matches its Plain depth and guard or healing is the answer. Plated and Regrowth were raised so Build Lab bursts no longer ignore them; tire starts at cycle 14 so they still cost a weak build a long fight but never a stall.


## Items, kits and builds (gauntlet round 4)

The ruler now values cards over a whole fight, so items that stack or grow count. Changes a player feels:

- **Hunger is a stock any build can burn.** Raw Meat: touching weapons deal +1 damage per 2 Hunger you hold (it grows through the fight; any family's weapons want it). Blood Cup now earns its own Hunger from hits (1 a cycle) instead of waiting on Hungry Tooth. The Hunger power feeds Hunger from every hit, so Cup, Meat and Tooth pay for a build that takes hits. Resource amounts read by an item fall back to its owner's stock (`values.js`).
- **Amplifiers work alone.** Wax Candle opens the fight with 2 Shock, Signet Ring with 2 Poison, and both still add 2 whenever the foe gains that status. Gambler's Chest also gives touching weapons +1 damage per 4 Salvage held. Purifying Salt gains 2 guard a turn besides washing out Poison.
- **Kits.** Rook starts with Raw Meat beside the dagger (a soldier's rations; the first Hunger piece and an early cross-family payoff). Nettle starts with Purifying Salt (guard and a Poison wash for the Hedge Doctor). Rook's builds end mixed, Combat with Hunger, Growth and Scholarship pieces.
- **A fourth evolution for the kit item every Rook has.** Whetstone touching the Rusty Dagger at level 5 becomes the Grindstone: touching weapons +potency damage, and the weapon to its right is sharpened for the same again. Rook and Nettle now meet an evolution on their own.
- **Offers favour known pairs.** Twelve pairs the Build Lab found beat their parts (across families: Oil Lantern + Ward Tooth, Lockpicks + Plate Glove, Bedroll + Ward Tooth, Purifying Salt + Signet Ring, Torn Banner + Spore Idol, and more; `synergyPairs` in `pool.js`) count as "completes something owned": the second item is `synergyWeight` times as likely, and the bot values it for the synergy.
- **Defence before a boss.** In a level-up draw one or two floors before a boss (floors 8-9, 18-19, ...), the first card is always a new item that guards or heals while one is left. Threats are unchanged.

Seeded bot runs (5 crews x 10): mean floor 27.6 -> about 32; Rook median 15 -> 23; evolution in 28 of 46 runs that reach floor 15 (was 19 of 44).

## Power spikes and luck (spikes pass)

The gauntlet left a slow burn: every level-up gave a card and a free level, items grew on a line, foes tired from cycle 14, and
Poison stacks never faded. Late fights all ended near cycle 23 on the tire timer, and weapons did almost nothing past floor 40.
This pass makes power come in jumps and makes runs differ by luck:

- Surges at item levels 2, 5, 9, 14, 20 and 27 (×1.5 each), so weapons keep pace with foes and a level card can be a big one.
- Training on 30% of level-ups instead of all; Embers per level grow by 2 instead of 3, so there are more card picks.
- Chests roll their level-ups by weight (elite 1/3/5 at 70/25/5, boss 3/5 at 70/30).
- Evolution at item level 4 instead of 5.
- Poison fades by a fifth each cycle; foes tire from cycle 24; foe health grows 1.15 per floor instead of 1.17.

`node tools/descent-sim.mjs` now prints the share of damage to foes from weapons, Poison, other statuses, tiring and other items by
depth band, and the power spikes per run (a normal fight at most half as long as the run's recent normal fights).
Measured with the bot, six runs each, with the tower from a real profile (Fortune 11, Kindling 20, Might 39, Lantern Oil 3, Vigor 10):

| Crew | Weapon share, floors 41–50, before → after | Tiring share, floors 51–60 | Cycles, floors 51–60 | Median floor |
|---|---|---|---|---|
| Moss | 50% → 89% | 79% → 1% | 20.0 → 9.8 | 52 → 59 |
| Rook | 29% → 75% | 28% → none reached | 13.3 → (floors 41–50: 3.2) | 40 → 47 |
| Briar | 15% → 31% (Poison 67% → 44%) | 41% → 0% | 16.2 → 8.0 | 62 → 54 |

Deaths now come over several floors of growing damage instead of one hit at full health. Spikes per run rose for Briar (1.5 → 2.2)
and are about 2 for Pip without a tower; with a large tower Rook and Moss win most fights in 1–2 cycles, so the measure sees few.

