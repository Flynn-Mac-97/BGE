# Brainstorm: new mechanics

Two fresh reviewers brainstormed separately, October 2026, with the same brief and no knowledge of each other or of Black Bell. They knew only the genre (a grid-backpack roguelite auto-battler) and checked novelty with a few web searches. Source A or B is the brainstorm; A + B means both reached the idea on their own. “Black Bell today” was added afterwards.

## Crafting your own items

### 1. Rune Sockets (A + B)

- **Core rule:** An item is a frame with sockets for a Trigger rune (when), an Effect rune (what) and a Target rune (who: adjacent, same row, the item to my left, the weakest item). Runes are found, bought or unlocked.
- **How it feels:** Writing a tiny program on a sword; finding a trick rather than buying a stat.
- **Why it is fresh:** Noita builds spell chains in a wand but has no grid. Using the grid as the targeting language is new.
- **Risk:** Combinations multiply balance work; infinite loops; hard to read what a custom item does.
- **First small version:** 3–4 triggers × 3–4 effects × 3 targets; one crafting bench per run; at most one rune reaction per item per step; a headless balance sweep.
- **Close games:** Noita (wand building); Backpack Battles and The Bazaar use fixed authored items
- **Black Bell today:** The Forge already builds items from WHEN, DO, TO and POWER, but only between runs, for Bells, as 1×1 items.

### 2. Grafting / Grammar Fusion (A + B)

- **Core rule:** Fuse two items: the result keeps A’s trigger and B’s effect, and the target follows the direction you fused in. A: fusing costs a scar that takes grid space.
- **How it feels:** “This shield blocks, that torch burns, so now: when I block, burn the attacker.” Each fusion reads as a sentence.
- **Why it is fresh:** Recipes in Backpack Battles are fixed lookups (X + Y = Z). This is generative: any pair gives a legal result.
- **Risk:** Some pairs are weak or dominant; needs a power budget or clamp; some players will not follow it.
- **First small version:** Tag 12–20 items with one trigger and one effect; one fusion per run; preview before confirming.
- **Close games:** Backpack Battles (fixed recipes)
- **Black Bell today:** Item rules already separate trigger, target and effects; evolutions are fixed recipes.

### 3. Overclock and Debt (B)

- **Core rule:** Overclock any item to double one number; it gains a Debt that comes due later in the fight, e.g. “after cycle 5, touching items are disabled for a cycle”.
- **How it feels:** Betting on timing: win fast or lose to your own greed.
- **Why it is fresh:** Power and its downside sit on the same item, and the downside hits neighbours, so layout becomes the defence.
- **Risk:** Feels unfair if the debt is hidden; it must be fully readable before the fight.
- **First small version:** One overclock button on weapons with one fixed debt type.
- **Close games:** —
- **Black Bell today:** None. Surges give jumps without a cost.

### 4. Item Notes (A)

- **Core rule:** Every item has one blank reaction line: an if-then the player picks from templates, e.g. “when I am struck, swap places with the item to my left”. Slots cost run currency.
- **How it feels:** Giving items a personality you can predict.
- **Why it is fresh:** A light, player-written hook rather than a full editor.
- **Risk:** Overlaps with Rune Sockets; build only one of the two first.
- **First small version:** 6 templates, one free slot per run.
- **Close games:** —
- **Black Bell today:** None.

### 5. Shared Item Codes (B)

- **Core rule:** Any crafted item exports as a short code. Others import it into their pool as a rare find, with the author credited and usage shown.
- **How it feels:** Finding a stranger’s strange invention in a shop: genius or trap?
- **Why it is fresh:** Games share builds, seeds or levels (Mario Maker); none found share custom items as in-run loot.
- **Risk:** Exploits spread fast; needs a power cap and name moderation.
- **First small version:** Local text-code export and import, checked against the same budget rules.
- **Close games:** Mario Maker (levels); Balatro seeds
- **Black Bell today:** Forged items are stored as part records, so a code is a short encoding of them.

### 6. Use-shaped Evolution (Mutation Bay / Mastery Marks) (A + B)

- **Core rule:** Items earn marks for what they did, e.g. “killed with 3 touching buffs”, “survived on 1 HP”. Marks unlock alternate versions with a different trigger or adjacency rule, across runs.
- **How it feels:** The sword becomes “yours” because of how you played it.
- **Why it is fresh:** Most meta progression is flat unlocks or stat boosts; this changes an item’s shape, and the unlock is the play style you liked.
- **Risk:** Players may grind one build and lose variety; unpredictable variants frustrate planners.
- **First small version:** 3–10 items with two marks each; each mark swaps one trigger.
- **Close games:** Super Auto Pets (fixed levels)
- **Black Bell today:** Item mastery counts floors won and adds +5%; evolutions need a fixed partner.

## Long-term rewards

### 7. Heirloom Lineage (A + B)

- **Core rule:** When a hero dies, pick one item to pass on. It returns next run, named and scarred; A: a little weaker each generation; B: arrives at 70% power and grows back over a few floors.
- **How it feels:** Passing the torch; items build up a story (“this axe has outlived four heroes”).
- **Why it is fresh:** Most roguelites reset fully; this is a controlled leak. Rogue Legacy passes on heirs, not items.
- **Risk:** Snowballing; cap at one item and reduce its power.
- **First small version:** One slot, one item, 70% value or −1 per generation, plus a line of history text.
- **Close games:** Rogue Legacy (heirs), Dead Cells (blueprints)
- **Black Bell today:** The Heirloom tower rank only raises starting item levels.

### 8. The Museum (donations) (A)

- **Core rule:** Donate a finished-run item once, into a gallery slot that has a challenge (“win with only 2 weapons”). Rewards are sideways, never raw power; full sets give more.
- **How it feels:** A collection you are proud of, and a reason to try odd items.
- **Why it is fresh:** Collection logs exist; tying each slot to how you used the item is new.
- **Risk:** Collection fatigue; bonuses creeping into power.
- **First small version:** 20 slots with a challenge each; reward: a new option in the starting shop.
- **Close games:** Hades codex, Dead Cells
- **Black Bell today:** None; the research suggested a codex with % complete.

### 9. Museum of Dead Builds (B)

- **Core rule:** Each dead hero’s backpack is saved as an exhibit with its layout, depth and cause of death. A later run may raid one exhibit once for one item, or learn it as a recipe.
- **How it feels:** Failures become an inheritance; a good death is not wasted.
- **Why it is fresh:** Here the build itself is the reward. Noita leaves items at death sites, not whole builds.
- **Risk:** Hoarding; raids trivialise early floors. One raid per run; exhibits decay.
- **First small version:** Save the last backpack; offer one of its items as a one-time shop pick next run, labelled “ghost”.
- **Close games:** Noita, Rogue Legacy
- **Black Bell today:** The Play Log already keeps each run’s final build for the last 20 runs.

### 10. Ladder of Vows (A)

- **Core rule:** Before a run, swear optional vows (“no shields”, “4×3 grid only”). Vows give account rank and titles, not run power.
- **How it feels:** Self-set challenges with lasting bragging rights.
- **Why it is fresh:** Heat and Boss Cells are difficulty ladders; vows are about build identity.
- **Risk:** Overlaps with a difficulty ladder.
- **First small version:** 8 vows; a rank number; a title every 5 ranks.
- **Close games:** Hades (Heat), Dead Cells (Boss Cells)
- **Black Bell today:** None; the research suggested a “Toll” ladder.

### 11. Scars (B)

- **Core rule:** After a hard win, the hero may take a Scar: a permanent rule with a good and a bad side (“+2 grid cells, but the first shop is closed”). Up to a cap; removable for a price.
- **How it feels:** The hero has a record, not a blank slate.
- **Why it is fresh:** Ascension and Heat add difficulty; scars give a lasting trade-off identity.
- **Risk:** Stuck with a scar you dislike; removal must be cheap.
- **First small version:** 6 scars, cap of 2.
- **Close games:** Darkest Dungeon (quirks)
- **Black Bell today:** None.

### 12. The Long Ledger (B)

- **Core rule:** A slow, shared goal across all players over weeks unlocks one global rule for a month, e.g. “Fire items cost 1 less”.
- **How it feels:** A calendar of small world changes; a reason to come back and see what shifted.
- **Why it is fresh:** Seasons are usually ladders or passes; this is community-driven and low pressure.
- **Risk:** Needs live operations; a bad rule spoils a month.
- **First small version:** A weekly rule from a fixed list, picked from the last week’s top deaths.
- **Close games:** Path of Exile leagues
- **Black Bell today:** None; no server.

## Starting loadout

### 13. Starter Workbench / Kit Forge (A + B)

- **Core rule:** Before a run, build the starting kit from your unlocked items with a points budget earned across runs; rarer items cost more.
- **How it feels:** A draft before the draft: “today I try a poison start.”
- **Why it is fresh:** Most games give a fixed kit per hero or class; here the kit is its own build puzzle and the meta progress.
- **Risk:** Collapses into one best kit; rotate banned tags weekly; the first minute becomes solved.
- **First small version:** 10–15 starter items, a 6–10 point budget, a “random kit” button, saved kit slots.
- **Close games:** Slay the Spire starter relics, Backpack Hero
- **Black Bell today:** Each crew member has a fixed kit.

### 14. Pack Habits (A)

- **Core rule:** The backpack itself has lasting quirks you tune over weeks: pockets that boost a tag, a cursed corner, a hole.
- **How it feels:** The bag is your instrument.
- **Why it is fresh:** Bag shape is usually fixed; a persistent personal layout is new.
- **Risk:** Hard to balance against runs that expect full space.
- **First small version:** One base bag with two tunable corner cells.
- **Close games:** —
- **Black Bell today:** Wide Back adds a column; storage packs add columns in a run.

### 15. Pre-run Contracts (A)

- **Core rule:** Before the run, agree to carry an unwanted item for N fights in exchange for a reward at the end.
- **How it feels:** A trade-off you feel immediately.
- **Why it is fresh:** Turns inventory clutter into a bet.
- **Risk:** A chore if the reward is small.
- **First small version:** 5 contracts, one per run, reward in Bells.
- **Close games:** —
- **Black Bell today:** None.

### 16. Loadout Contracts (B)

- **Core rule:** Start with a strong item you have not unlocked, bound by a condition (“no shop items in row 1”). Break it and the item is lost.
- **How it feels:** A taste of the late game early, with a rule to honour.
- **Why it is fresh:** Turns unlock gates into a playable challenge.
- **Risk:** The condition must be tracked clearly in the UI.
- **First small version:** 5 contract items with one checkable condition each.
- **Close games:** Hades (Pact of Punishment)
- **Black Bell today:** None.

## Anything new

### 17. The Rival (B)

- **Core rule:** Your last run’s best backpack, slightly mutated to counter what you used most, becomes a boss at floor 5 of your next run.
- **How it feels:** A personal nemesis made from your own habits.
- **Why it is fresh:** Ghosts are usually other players; a self-ghost that adapts was not found.
- **Risk:** A rival from a strong run can be unfair; cap it with a budget.
- **First small version:** Replay last run’s final backpack with one item swapped for a counter.
- **Close games:** Shadow of Mordor (Nemesis); Turnbound, Gridlords (ghosts)
- **Black Bell today:** Final builds are saved in the Play Log; the Duel Pit already fights two grids.

### 18. Ghost Mentor (A)

- **Core rule:** After a run, leave your final build with pre-written notes. A player who loses to it can study it and borrow its author’s item reactions for one run.
- **How it feels:** You learn from whoever beat you, and they get credit.
- **Why it is fresh:** Ghost PvP exists; turning a loss into a credited gift does not.
- **Risk:** Moderation; ghosts too strong.
- **First small version:** Pre-written notes only; 3 saved ghosts per player.
- **Close games:** The Bazaar, Backpack Battles, Turnbound
- **Black Bell today:** No ghosts; no server.

### 19. Replay Puzzles (A)

- **Core rule:** A fight replay is a small file. Anyone can rearrange the loser’s grid and re-run the same fight to see if it would win.
- **How it feels:** Chess puzzles from real fights.
- **Why it is fresh:** Replays are shared, but editable replays as puzzles are not.
- **Risk:** Needs fully repeatable fights.
- **First small version:** Local only: load a saved fight, move two items, re-run, compare.
- **Close games:** —
- **Black Bell today:** Fights are already repeatable from the same start; this is cheap.

### 20. Design-a-Boss Daily Puzzle (B)

- **Core rule:** A daily puzzle: a fixed enemy backpack, and you build a loadout within a budget that beats it. Everyone gets the same puzzle.
- **How it feels:** A Wordle-style daily teaser in the game’s own rules.
- **Why it is fresh:** Daily seeds exist; a fixed puzzle answered by a build was not found.
- **Risk:** Needs content or generation, and a solvability check.
- **First small version:** 7 hand-made puzzles with one known solution each.
- **Close games:** Slay the Spire daily, Wordle
- **Black Bell today:** The Family Lab already has preset layouts against a fixed dummy.

### 21. Daily Rule Mutators (A)

- **Core rule:** The daily run changes one rule of how items fire, e.g. “triggers fire twice, effects halved”.
- **How it feels:** A fresh meta every day.
- **Why it is fresh:** Daily seeds are common; a change to the trigger rules is not.
- **Risk:** A mutator can break the game; test each one.
- **First small version:** 6 mutators in rotation, no leaderboard.
- **Close games:** Slay the Spire daily
- **Black Bell today:** Every number is in one tuning table, so rule changes are cheap.

### 22. Fewest-items Leaderboards (A)

- **Core rule:** Beat a fixed boss with the fewest items or the smallest footprint. Score is your place on a chart of all players.
- **How it feels:** Elegance, not just power.
- **Why it is fresh:** Opus Magnum does this for puzzles; no auto-battler found.
- **Risk:** A small audience.
- **First small version:** One fixed boss, three score axes, local ranking.
- **Close games:** Opus Magnum, Zachtronics games
- **Black Bell today:** Fights run headless and repeatably, so scoring is cheap.

### 23. Backpack Weather (B)

- **Core rule:** Some fights change the grid itself: cells freeze, a row rotates, or two rows swap every few cycles. A forecast shows it before the fight.
- **How it feels:** Your layout is alive; you design it for stress.
- **Why it is fresh:** Adjacency in the genre is static; adjacency that changes over time is a new axis.
- **Risk:** Feels random unless forecast.
- **First small version:** One event, “rows swap at cycle 4”, with a preview line.
- **Close games:** Puzzle games with shifting boards
- **Black Bell today:** Items act in reading order, so a row swap changes the order too.

### 24. Cursed Cell Auctions (B)

- **Core rule:** Each floor offers a locked, cursed grid cell. Pay for it by sacrificing items to gain the space.
- **How it feels:** Space is a currency you gamble for, not a given.
- **Why it is fresh:** Space usually unlocks by progress; bidding for it is new.
- **Risk:** Punishes weak builds and snowballs strong ones.
- **First small version:** One auction per run with a small fixed set of curses.
- **Close games:** Backpack Hero, Backpack Battles
- **Black Bell today:** The Wider Back card adds a column for free.

### 25. The Hero Is an Item (A)

- **Core rule:** The hero is a placed tile on the grid with its own triggers; moving the hero next to things changes the fight.
- **How it feels:** The hero is a puzzle piece, not a health bar.
- **Why it is fresh:** Heroes in the genre are stat blocks.
- **Risk:** Reshapes the whole game.
- **First small version:** A 1×1 hero tile with one adjacency bonus.
- **Close games:** —
- **Black Bell today:** The hero is an actor outside the grid.

### 26. Item Dialogue (B)

- **Core rule:** Items have opinions of neighbours: “Fire likes Oil, hates Ice”. Likes give a boost, hates a penalty, shown as one line in the tooltip.
- **How it feels:** A crowded backpack with moods, and some humour.
- **Why it is fresh:** A named relationship system instead of plain tag matching.
- **Risk:** Hard to balance; players may ignore the flavour.
- **First small version:** One like and one hate tag on 10 items.
- **Close games:** —
- **Black Bell today:** Auras and adjacency rules can already express this.

### 27. Betrayal Items (A)

- **Core rule:** Some items build a visible grudge if left untouched by triggers for a few fights, and turn on you in a boss fight.
- **How it feels:** Fear, and a reason to keep a layout tidy.
- **Why it is fresh:** Cursed items are usually a flat penalty; punishing neglect is rare.
- **Risk:** Unfair if hidden; show the counter.
- **First small version:** 3 grudge items with a visible counter.
- **Close games:** —
- **Black Bell today:** None.

### 28. Spectator Blessings (B)

- **Core rule:** Viewers of an async replay bet on the winner and may add one small, visible, buff-only chip to the hero’s next floor.
- **How it feels:** A crowd that is chaotic but not cruel.
- **Why it is fresh:** Audience influence exists as streamer mods, not built in and async.
- **Risk:** Griefing; allow only buffs.
- **First small version:** Local only: a friend can leave one blessing as a code.
- **Close games:** Slay the Spire Twitch mods, Choice Chamber
- **Black Bell today:** None.

### 29. Co-op Backpack (A + B)

- **Core rule:** Two players share one grid: each owns half the cells (or one places and one chooses), and adjacency reaches across the border.
- **How it feels:** Talking about layouts; your partner’s choices change your build.
- **Why it is fresh:** No co-op shared-grid auto-battler found.
- **Risk:** Networking; uneven skill; a small player pool.
- **First small version:** Hot-seat on one screen with a fixed pair of heroes.
- **Close games:** Overcooked (shared space)
- **Black Bell today:** The Duel Pit is already same-screen two-player.

## What each brainstorm would build first

| Rank | A | B |
|---|---|---|
| 1 | Rune Sockets | Rune Sockets |
| 2 | Starter Workbench | The Rival |
| 3 | Ghost Mentor | Museum of Dead Builds |
| 4 | Heirloom Lineage | Starter Kit Forge |
| 5 | Fewest-items Leaderboards | Backpack Weather |
| Reserve | Item Grafting; The Hero Is an Item | Mastery Marks; Design-a-Boss Daily Puzzle |
