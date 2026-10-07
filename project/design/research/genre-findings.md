# Genre research: interactions, enemies and rewards

Findings from comparing Black Bell's Descent with similar games, October 2026. Counts are approximate, from general knowledge of
the games, and change with patches; none were checked against live sources.

## 1. Interactions: how many, and how complex

| Game | Statuses / keywords | Triggers / timings | Position rule | Per-effect complexity |
|---|---|---|---|---|
| Backpack Battles | About 10 (Heat, Regeneration, Luck, Spikes, Vampirism, Mana; Poison, Cold, Blind) | About 5: every X s, on hit, on being hit, battle start, "with N of a buff" | Neighbours an item boosts; bags give space | One line per item; hundreds of items reuse ten words |
| The Bazaar | About 12 keywords (Damage, Shield, Heal, Burn, Poison, Regen, Haste, Slow, Freeze, Charge, Crit, Multicast) | Cooldowns; "when you use an item"; "when an adjacent item is used" | One row; left and right neighbours; item sizes | One or two short clauses |
| Super Auto Pets | About 10 perks | About 15–20 triggers (battle start, hurt, faint, before attack, buy, sell, level-up, friend summoned) | A line: front and behind | One trigger and one effect per pet; complexity from chains |
| Slay the Spire | About 25–30 powers; core: Strength, Dexterity, Vulnerable (+50% taken), Weak (−25% dealt), Frail, Poison, Block | Turn start, turn end, on attack, on play | None | "N per stack" or a fixed %, each with one fixed fade rule |
| Balatro | About 3 number channels: Chips, +Mult, ×Mult, plus editions and seals | On scored, at the end, left to right | Joker order | 150 jokers from add, multiply and order |
| Vampire Survivors | Almost none; about 20 percentage passives | Weapon cooldowns | None | Evolutions: max weapon + named passive |

Patterns:
1. About 8–12 statuses in total; hundreds of items reuse them.
2. Items carry the complexity (when, who); statuses carry the vocabulary.
3. Each status has one fixed fade or duration rule.
4. Two or three core debuffs do most of the work: take more, deal less, damage over time.
5. One clear positional idea per game. Black Bell already has two: reading order and adjacency.
6. Spikes come from multipliers and transformations (×Mult, evolutions), not from more keywords.

For Black Bell: ten statuses, two per family, is the genre norm. Add depth through triggers, not statuses. A rare "×" payoff could
give spikes.

## 2. Enemy design

| Game | What an enemy is | Lesson |
|---|---|---|
| Slay the Spire | A small move list with a visible intent; elites and bosses each punish one habit | Telegraph the next hit; each boss punishes one habit |
| Backpack Battles | Another player's backpack, replayed | Enemies use the player's own statuses |
| The Bazaar | Monsters with small item boards | Each enemy is a small build, not a stat block |
| Super Auto Pets | Another team; order decides | Some enemies act first or mid-scan |
| Vampire Survivors | Waves of trivial foes, rare elites and bosses | Most floors can be stomps if elites and bosses stand apart |
| Balatro | Boss Blinds: one rule twist each | Boss modifiers as rule twists; cheap to build, memorable |

Patterns: few enemy verbs, many combinations; counterplay shown before the fight; each enemy tests one thing; bosses change a
rule, not just numbers; enemies speak the player's language.

For Black Bell: show the foe's intent for the coming cycle; keep one or two threats per normal foe; tie threats to status kinds
(Purifier removes Harm, a new Steadfast ignores Weaken); give each boss one rule twist; let some foes apply the family statuses to
the player.

## 3. Rewards and meta progression

Black Bell today: one currency (Bells) buys Bell Tower ranks, four endless +X% (Vigor, Might, Kindling, Fortune) and five capped
unlocks; item mastery +5% a level; crew unlock at floors 10, 15 and 25; the death screen is a static list.

| Game | Reward loop | Why it works |
|---|---|---|
| Cookie Clicker | Exponential numbers, threshold upgrades, achievements; prestige buys a permanent upgrade tree | Visible growth, constant unlocks, prestige that changes rules |
| AFK Arena / Idle Heroes | Offline rewards, daily chests, ascension, collection | Coming back is rewarded |
| Vampire Survivors | Gold for flat boosts; real rewards are achievement unlocks | Each run likely unlocks something new |
| Dead Cells | Cells buy blueprints that add items to the pool | The pool of possibilities grows |
| Hades | Several currencies with separate purposes; the house changes | Each currency is a different decision |
| Rogue Legacy | Gold builds a castle of perks | Progress is a place you see grow |
| Slay the Spire / Balatro | Unlocks, then a difficulty ladder; collections with % complete | Mastery becomes the reward |
| Brotato | Character unlocks from in-run challenges; danger levels | A short checklist per character |

Patterns: unlocks beat percentages; concrete goals with visible progress; a home that grows; a ceremony at run end; a collection
with % complete; prestige that changes rules; a difficulty ladder; a reason to come back.

For Black Bell, in order of payoff: a death-screen ceremony (count-up, best moment, unlock cards, progress bars); items unlocked
into the pool by goals; fewer tower nodes that add mechanics instead of percentages. Later: a Lantern scene that grows, a codex,
a Toll difficulty ladder, offline Bells capped at about 8 hours, and a daily seeded descent.

## 4. Independent review

A separate reviewer answered the same three questions as general design questions, with no knowledge of Black Bell and no access
to these findings.

| Topic | Agrees | Adds or differs |
|---|---|---|
| Interactions | About 8–12 core verbs; depth from many items reusing them; one-hop triggers | Count the decisions a keyword creates, not the keywords. Auto-battlers need a log or replay so a player can see why they lost. Hidden order rules are bad complexity. |
| Enemies | Each foe tests one axis; enemies use the player's keywords; telegraph big threats | A live intent display does not fit a game with no input during the fight: show a pre-fight scouting screen instead. Rotate which archetype is weak. No foe that punishes a build the player could not have known to avoid. |
| Rewards | Unlocks and new verbs beat flat %; failure must pay; flat % is invisible | The run-end screen should credit the build ("Poison dealt 62% of your damage"). Reward rhythm in layers: seconds, a run, a few runs. Legibility matters more than frequency. Prestige only works if the next run is faster and different. |

Its main warning: designers treat complexity as content and build large systems first. Ship a small, legible core and add only
when players have used up what exists.

## 5. Independent review with web search

A third reviewer answered the same general questions with web search. Page fetches were blocked by this environment's network
policy, so "verified" means confirmed in search-result text, not in the full page.

Verified facts:
- Backpack Battles has 400+ items that interact by adjacency and tags such as "food" and "dark"; it is mainly asynchronous PvP
  against other players' saved builds. ([Wikipedia](https://en.wikipedia.org/wiki/Backpack_Battles))
- The Bazaar's keywords are one sentence each: Haste (charge twice as fast), Slow (half speed), Freeze (no charge, no activation),
  Shield (blocks damage, ignored by Poison, halves Burn), Regen (heal its amount every second).
  ([Mobalytics](https://mobalytics.gg/the-bazaar/guides/keywords-and-terms))
- Slay the Spire has 250+ cards and about 150 relics (one source says 127).
- Hades has 28 duo boons; Hades II has 37.
- Vampire Survivors has 46 standard weapons and 5 free weapon slots after the starting one.
- Cookie Clicker's prestige gives +1% production per prestige level, and Heavenly Chips buy permanent upgrades.

New points from this review:
- With N keywords, pairwise interactions grow about as N²; keep that count visible and capped.
- A budget for a new game: about 8–12 statuses, about 5 triggers, every status with one stated rule and one stated counter.
- Author enemies as builds made from the player's own items and keywords; ghosts of other players need a player base first.
- Unlocks that only add items to the pool can dilute good builds; meta rewards should add choices before power.
- A reward is information: "you won because of X, and X now unlocks Y" beats a bigger number.
