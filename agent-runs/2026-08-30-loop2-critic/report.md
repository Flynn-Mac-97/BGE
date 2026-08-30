# Kitten Survivors — loop 2 critic report

Played three full runs in the live editor at http://localhost:5180 (tab title verified
"kitten-survivors — engine"), died once legitimately at 0:47, and drove an instrumented
run to 6:18 in the browser. Every number below was measured — headless via
`startWorldInNode` checkpoint scripts (the project's own `measure-density.mjs` pattern,
with the `await` bug fixed — see defect 12), or by in-page probes and the game's HUD.
The live browser run and headless agree where they overlap (live: 1109 kills / 289 alive
at 4:10; headless: 1157 / 280 at 4:00), so the headless numbers stand for the marks the
browser couldn't reach.

Method note: at-range motion claims (hound pounce timing, boar charge kinematics) were
verified in code and by coarse motion between paired zooms, not frame-by-frame; I do not
report on their feel.

## Ranked defects, worst first

### 1. The build system is a placebo — every weapon card does nothing
What I saw: took **Red Dot** at LV2 — no dot ever circles the kitten. Took **Yarn Ball**
("New") at LV6 — still exactly two pink orbit cubes. Took **Spilt Milk**, **Hairball**,
**Claw Swipe x3** across runs — zero visible or numeric change, yet the HUD strip and the
death card list them all as owned. Passives **Sharp Teeth** (+damage), **Quick Claws**
(-cooldown) and **Fluffy Tail** (+area) are equally dead: nothing reads
`damageScale`/`cooldownScale`/`areaScale` off the kitten. Only Swift Paws
(`properties.speed`, read at `kitten-survivors/types/kitten.js:106`), Long Whiskers
(`pickupRadius`, read at `plugins/builtin/pickups.js:71`), Full Belly (maxHealth) and
Saucer of Milk work.

Why: `grantWeapon` at `kitten-survivors/plugins/kitten-upgrades.js:239-246` calls
`context.weapons.upgrade/levelUp/grant/give` — but the weapons lane publishes
**`context.autoWeapons`** (`plugins/builtin/auto-weapons.js:197`) and expects names like
`'yarn ball'`, not card ids like `'yarn-ball'` (`kitten-survivors/plugins/kitten-weapons.js:19`
documents the intended call). Nothing anywhere consumes the `kitten:upgraded` event or
`entity.arsenal`. Two lanes each finished their half; the join belongs to neither.
The card deck also describes weapons that don't exist (Whisker Lash, Claw Swipe, Spilt
Milk, Red Dot) while the four real weapons (claw dart, yarn ball, purr wave, hairball —
all granted at 0:00 by `kitten-weapons.js:82-85`) are never upgradeable. "Hairball (New)"
is offered while hairballs are already flying.

Vampire Survivors: the level-up choice IS the game — every pick visibly changes the
screen within seconds. Here a run's arc is flat: the kitten at minute 6 fights exactly
like the kitten at minute 0.

### 2. Giant black and red squares — engine blood decals in a pastel kitten game
What I saw: a ~6-metre flat **near-black square** appears under the kitten every few
seconds and lingers, hiding the kitten and everything near it (screenshots at 0:23, 0:32,
0:38, 0:45, 0:51, 6:21). Dark-red 1.1 m squares accumulate wherever things die and last
40 seconds; by minute 4 the meadow is speckled with red slabs.

Why: the hairball burst emits `explosion`
(`kitten-survivors/plugins/kitten-weapons.js:288`) and Combat Effects answers every
explosion with a 6x6 scorch decal tinted `#2a2320`
(`plugins/builtin/combat-effects.js:145-152`), and every `entity:killed` with a 1.1 m
blood decal tinted `#7a0d0d`, life 40 (`combat-effects.js:119-130`). The game never set
`particles.art.blood`, and "an untextured decal is a tinted quad"
(`plugins/builtin/particles.js:299`) — so they render as solid colored squares.
`kitten-hit-feel.js:50-54` recoloured the blood *particles* to fur but forgot the decals.

Vampire Survivors: deaths leave nothing on the ground; the arena stays readable for 30
minutes. A cute-kitten art language ("never gore" — kitten-effects.js) is being betrayed
by its own engine defaults.

### 3. Death -> retry soft-locks the game
What I saw: the at-death card is correct ("you lasted 0:47 — Level 6 — 126 killed" plus
the carried list). Press **R**: the world resets but the card re-renders as "you lasted
0:00 — Level 1 — 0 killed — nothing but claws", frozen at 0:00. Press R again: nothing.
Fully reproducible; only STOP->PLAY in the editor toolbar recovers. The stale card also
survives into edit mode over the editor viewport after STOP.

Why: R reloads the level (`kitten-survivors/plugins/kitten-progression.js:203-217`);
run-clock resets on `level:loaded`, but its watcher immediately re-ends the not-yet-begun
run and re-holds the loop (`plugins/builtin/run-clock.js` — `watch`/`end`/HOLD), and a
held loop never runs the fixed step that reads the next R (`kitten-progression.js:219-224`).

Vampire Survivors: retry is instant and bulletproof — it is the most-pressed button in
the genre.

### 4. Minute one kills a moving player — the difficulty curve is inverted
What I saw: constantly moving, all four starting weapons firing, 126 kills — dead at
**0:47**. HP flow: 100 at 0:09, 82 at 0:15, 64/120 at 0:23, 40 at 0:30, 16 at 0:45,
dead 0:47. A second stationary run died before 1:30. Rats bite 6 per half-second per rat
(`kitten-survivors/types/rat.js:46`, `kitten-danger.js:26`), the crowd is 86 by 0:30
(measured), and brushing a pack costs 30+ HP/s. Meanwhile the picks you earn (defect 1)
don't make you stronger, so there is no counter-curve — later minutes only get worse.
My kiting was scripted and crude; a skilled human lasts longer, but the genre baseline is
that minute one is nearly lossless.

Vampire Survivors: the first minutes are a warm-up; death comes when the crowd outgrows
your build, not before your first three picks.

### 5. Level-up modal spam in the opening minute
What I saw: LEVEL UP at 0:09, 0:15, 0:23, 0:30, 0:42 — five full-screen pauses in 42
seconds; in run 1, two modals one second apart (0:50, 0:51). After minute two the levels
stall (one level in 77 s) because kills plateau.

Why: `CURVE = level => 5 * level` (`kitten-survivors/plugins/kitten-progression.js:34`)
against 3-5 kills/s of 1-XP gems from 0:05. The curve is linear while early kill rate is
front-loaded.

Vampire Survivors: first pick ~20-40 s, then a smooth cadence; the game never interrupts
itself twice in two seconds.

### 6. The 600-crowd is real but invisible late — pressure lives off screen
Verified headless (walking, healed, cards answered): alive/cap = **86/88 at 0:30, 225/225
at 3:00, 390/390 at 6:00, 600/600 at 10:00**, families evolving per schedule (at 10:00:
rat 211, wasp 156, crow 101, hound 77, boar 55). The claim's "~78 by 0:30" is close
(measured 86; cap 88), "225 by 3:00" exact, "600 late" exact at 9:49+.
But on screen: at 1:00 the view holds ~85 enemies (measured by projecting positions —
genuinely crowded); at **6:13, 401 alive and single digits visible**. A live kitten's
kill rate clears the visible disc and the cap population becomes a ring of stragglers
between the camera (~19 units across, `horde.stats cameraSees`) and the spawn band
(22-28.7). The screenshot at 6:13 looks emptier than the one at 0:47.

Vampire Survivors: minute six is a closing wall on every edge. The number that matters
is enemies *on screen*, and no lane is currently measuring it.

### 7. The meadow reads as a rendering glitch, not art
Overlapping giant flat quads in mismatched greens and yellows tile the arena; several
render near-black under the game light (one top-right corner quad reads as a dark
starfield; another showed striated texture artifacts). The kitten often stands on a
saturated-green island inside a dark patchwork. First-time viewers will file this as
z-fighting or missing textures. (`kitten-survivors/levels/meadow.json` patch placements +
`types/meadow-prop.js` toon material; textures exist in `assets/meadow/`.)
VS floors are one seamless tiling texture that recedes behind the crowd.

### 8. Weapons, projectiles and gems are untextured cubes
The yarn ring is two pink cubes; the hairball a brown cube; claw darts cream boxes; XP
gems flat-shaded cubes (blue/green/pink tiers — `kitten-progression.js:37-40`). Claim 6's
"gems sparkle" is technically present (shared idle glint + a genuinely nice latch trail,
`kitten-effects.js:37-45`) but the gem itself is a Minecraft cube next to six good GLB
creatures. VS pickups glow and pulse; its projectiles are the loudest art in the game.

### 9. Big bursts white-out the screen as bokeh mush
Level fountain (90 particles) plus purr wave (70 per ring, every 2.8 s) render as large
soft overlapping circles; at 0:45 roughly a quarter of the playfield was unreadable blur
for a beat. Sizes/softness (`particle-painter.js` fragment smoothstep 1.0->0.55, sizes and
counts in `kitten-effects.js`) need tightening — sparks should be pixels, not clouds.

### 10. Heal-after-death leaves a zombie kitten (reachable by game code)
Restoring `properties.health` does not restore `damageable.alive`; auto-weapons skips
dead owners (`plugins/builtin/auto-weapons.js:227`), so a heal racing a death produces a
full-health kitten whose weapons never fire again while the run continues. Saucer of Milk
heals exactly this way (`kitten-upgrades.js:210`). I hit the state via scripted heal —
weapons at 34/10/12/9 fired, frozen across 600 verified steps.

### 11. The dev harness destroys runs
During ~50 minutes the session fell out of play mode into the editor at least four times
(page reload or mode flip; no console trace survives, no repo file changed). Twice this
manifested as the death card floating over the editor with zeroed numbers. Separately,
`world.state.kills` has two writers (`horde.js` sweep and `kitten-progression.js`), which
is a divergence waiting to happen.

### 12. Measurement tooling rot (how loop-1-style fiction happens)
`horde.stats`' command handler is now async (`kitten-survivors/plugins/horde.js:433`
awaits `camera.ruleRead`) and `engine.run` returns the un-awaited Promise
(`engine/inspect.js:134-142`) — so `agent-runs/horde/measure-density.mjs:77-87` reads
`stats.alive` off a Promise: **undefined in every printed row**. And the live
(non-headless) CLI `run horde.stats` answers from the edit-mode world (time 0, born 0)
while a run plays in the browser. Logged as painpoints p127-p130.

## What genuinely works now

- **All six creatures are real GLB models** (`kitten-survivors/assets/models/*.glb`) and
  read as distinct species in play: brown rat swarms, jet-black gliding crows, big gray
  hounds arriving as an actual wall at 4:11, yellow-striped winged wasps at height, boars
  by minute 6. The kitten trots with visible legs and tail and is genuinely charming.
- **Per-family gaits exist and move** (`kitten-survivors/plugins/horde-drive.js`): rat
  run-a-beat/freeze-a-beat scurry, hound lope with a locked pounce, crow and wasp bobs at
  deliberately different rates, boar stalk-brace-charge with a tell. Paired zooms show
  everything advancing and banking; nothing moon-glides.
- **The population schedule holds its cap exactly** at every mark measured (0:30 through
  10:00), the family mix follows the written schedule, and the spawn ring hugs just off
  camera (22-28.7 units vs 19.2 visible) — new rats stream into view within seconds of
  spawning, and the first crowd is on screen well before 0:30.
- **Hit feedback fundamentals are in**: damage numbers are crisp and readable at a glance
  with a gold crit variant; per-weapon hit sparks; soft fur-toned death puffs (the de-gore
  recolour works); the gem latch trail is a lovely touch; the level-up gold fountain is
  loud good news when a black square isn't under it.
- **The choice screen is clean VS grammar**: three cards, 1-3/arrows/Enter, New vs Rank
  tags, no duplicate cards, saucer-of-milk filler, world properly paused during the pick.
- **The at-death result card** (at the moment of death) reports honest numbers and the
  carried build — the summary layer works; only the retry path (defect 3) ruins it.
- **Headless and live agree**, which means the engine's determinism story is holding and
  future loops can trust `startWorldInNode` harnesses — once they `await engine.run`.

## Claim-by-claim verdict

| Loop 2 claim | Verdict |
|---|---|
| (1) Spawns just off screen, visible fast | TRUE — ring 22-28.7 vs camera 19.2; streams visible by 0:10 |
| (2) Cap ~78 @0:30 / 225 @3:00 / 600 late | TRUE (measured 86/88, 225/225, 600/600 @10:00) — but see defect 6: the cap is off screen late |
| (3) Rat bursts, hound lopes+lunges, boar charges, flyers bob | Implemented (horde-drive.js) and motion observed; fine kinematics not frame-verified |
| (4) Six GLB creatures, kitten leg swing | TRUE — all six .glb on disk and seen in play; kitten trot visible |
| (5) Damage numbers readable | TRUE — best-in-build feature |
| (6) Hits spark, deaths puff, gems sparkle, level-ups burst | Mostly TRUE — but the same event wiring also drops black/red decal squares (defect 2), and bursts over-bloom (defect 9) |

## Priority for loop 3

Fix 1 (wire upgrades to autoWeapons), 2 (kill the decals or give them art), 3 (retry),
then rebalance 4/5 together — bite damage down or armor up in minute one, XP curve
steepened. Defect 6 wants a design decision: either shrink the kill-at-range power or
spawn-bias toward the camera edges so the wall is visible. Everything else is polish.
