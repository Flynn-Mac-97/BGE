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
| About a minute | The Ember bar fills. Choose 1 of 3 cards: level up an owned item, or, rarely, a new item. | Constant small choices; every card shows before → after numbers. |
| About five minutes | Every 5th floor is an elite, and every 10th a boss. Both drop a chest. A chest evolves an eligible item, or gives free level-ups. | A goal you can see coming and plan the grid for. |
| A run | Depth is the score. New crew unlock at depth 10, 15 and 25. | "One more floor." |
| Between runs | Bells buy Bell Tower ranks: more health, more Embers, rerolls, a fourth card, higher starting levels, a wider back. | Each death still moves you forward. |

## Rules

- **Items level without limit.** Every number an item has is a stat. At level L each stat is `base × (1 + growth × (L − 1))`, rounded. `growth` is in `plugins/bell/descent/tuning.js`.
- **No duplicate drops.** A card for an item you own is a level-up. New items are rare: their weight falls with every item you own, and there is a hard cap.
- **Evolution.** An item at its recipe's level, touching its partner item on the grid, evolves at the next chest. It keeps its level, gains a new name, a new ability and the evolved border. Recipes are in `descent/evolutions.js`.
- **Health carries over.** The recruit recovers a share of health after each floor, and each level-up raises max health a little.
- **Rerolls.** A run starts with a few rerolls; each redraws the current cards.
- **Death.** The run ends at once. Bells: 1 per floor cleared, more for elites and bosses.
- **Stall.** A fight with no winner after the cycle cap is a defeat. Builds must kill.

## Scaling

Enemy health and damage grow by a fixed factor every floor (exponential). Item
levels grow linearly, and evolutions and synergies multiply them, so a good
build stays ahead for a long time and then is overrun. Elites and bosses
multiply health. All factors are in `tuning.js`. `node tools/descent-sim.mjs`
plays seeded runs with a simple bot and prints the depths reached, then, for
each floor kind, the average fight length, the share of health lost and the
deaths; use it after any change to the numbers.

The kind multipliers aim for a curve, not walls: normal floors cost about
15% of health, elites about 30%, bosses about 60%, and bosses cause a little
over half of all deaths (before this tuning they caused 80%, and normal floors
cost under 10%). Measured with 40 bot runs each of Nettle, Rook and Briar,
median floor about 20.

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

Measured with 40 bot runs each, median floor: Rook 23, Nettle 30, Pip 30
(the older bot on the old pool: 18, 20, 25). 0.63 evolutions a run, two thirds
of them Widow's Fang: every crew starts with the Rusty Dagger and Venom Vial is
a common drop, so the poison evolution is the easiest one to reach.

Consumables have their own card weight, so they keep turning up however many
items the run owns.

A level-up draw holds at most two level cards, and its last card is always new
(an item, a consumable or a tome) while any are left. Level cards weigh less
than they did, and new items fall off more slowly as the run owns more. Before
this, about 70% of all cards offered were level cards and a run saw about 10
of the 21 new items; now under half are level cards and a run sees about 14.

## Data, by file

| File | Holds |
| --- | --- |
| `plugins/bell/descent/tuning.js` | Every number: growth, scaling, Ember curve, card weights, chest cadence, Bells. |
| `plugins/bell/descent/pool.js` | Which items can drop, and the starting crew and their kits. |
| `plugins/bell/descent/enemies.js` | Enemy bands by depth, with their lines of narration. |
| `plugins/bell/descent/evolutions.js` | Recipes and the evolved items. |
| `plugins/bell/descent/tower.js` | Bell Tower upgrades, their ranks and costs. |
| `plugins/bell/descent/run.js` | The run: floors, Embers, cards, chests, evolution, death. Plain records in and out. |
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
