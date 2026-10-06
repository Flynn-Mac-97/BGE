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
| About a minute | The Ember bar fills. Choose 1 of 3 cards, then train one item of your choice +1 level. | Constant small choices, and one you aim yourself. |
| Every boss | The travelling Peddler visits. Spend Coin on wares from every family and one evolved item; sell what you no longer need. | You steer the build: buy the piece you are missing. |
| About five minutes | Every 5th floor is an elite, and every 10th a boss. Both drop a chest. A chest evolves an eligible item, or gives free level-ups. | A goal you can see coming and plan the grid for. |
| A run | Depth is the score. New crew unlock at depth 10, 15 and 25. | "One more floor." |
| Between runs | Bells buy Bell Tower ranks, and every item you used gains mastery. Vigor, Might, Kindling and Fortune never cap. | You hit a wall, prestige, and break it next time. |

## Rules

- **Items level without limit.** Every number an item has is a stat. At level L each stat is `base × (1 + growth × (L − 1))`, rounded. `growth` is in `plugins/bell/descent/tuning.js`.
- **No duplicate drops.** A card for an item you own is a level-up. New items are rare: their weight falls with every item you own, and there is a hard cap.
- **Evolution.** An item at its recipe's level, touching its partner item on the grid, evolves at the next chest. It keeps its level, gains a new name, a new ability and the evolved border. Recipes are in `descent/evolutions.js`.
- **Health carries over.** The recruit recovers a share of health after each floor, and each level-up raises max health a little.
- **Rerolls.** A run starts with a few rerolls; each redraws the current cards.
- **Death.** The run ends at once. Bells: 1 per floor cleared, more for elites and bosses.
- **Stall.** A fight with no winner after the cycle cap is a defeat. Every foe tires: from cycle 12 it loses 8% of its health each cycle, through guard (`tuning.enemy.tire`, `tireAbility` in `enemies.js`). A build that cannot kill a Plated or Regrowth foe can still outlast it.

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
plans by trying: each candidate cell or card gets a two-cycle test bout against
the floor's enemy (which cannot die), scored as damage dealt minus health lost.
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

A level-up draw holds at most one level card (training is the second step of every level-up), and its last card is always new
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
through guard. Blood Frenzy (Hunger): below half health, weapons +40% damage.
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
climbing floors 14–44 against each until it loses; its score is the mean depth.
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

Every level-up has two steps: choose one of the cards, then train one owned
item +1 level (phase `train`). The second step is aimed, so a build can be
pushed where it is weak.

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
