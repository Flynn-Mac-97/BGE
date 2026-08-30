# Loop 1 — Kitten Survivors against Brawl Stars

Five lanes, all merged. The blind critic picked the shipped game correctly and
graded this build 2 to 5 out of 10.

## What the numbers say

Every world ruling in the art bible now passes. The baseline broke two.

| ruling | baseline | merged |
|---|---|---|
| `value.p95` at least 0.66 | 0.609 broken | 0.718 |
| `edgeDensity` at most 0.045 | 0.053 broken | 0.011 |
| `value.median` at least 0.43 | 0.436 | 0.717 |
| `value.spread` at least 0.27 | 0.427 | 0.358 |
| `warmShare` at least 0.35 | 0.862 | 0.981 |
| render saturation | 1.000, every pixel clipped | 0.467 |

Checks: `check` ok. Engine suites 44 pass, 0 fail. Game tests 6 pass, 1 fail —
a corpse-collection assertion, recorded as p204.

## What the critic said

It was given three in-game frames and three real Brawl Stars frames, unlabelled,
and asked which set had shipped. It named the right one and gave three reasons:

1. Every unit in the reference wears the same three-part kit — a dark keyline, a
   coloured ground ring, a nameplate with a health bar. No unit here wears any of
   it.
2. The reference ground is authored — texture, scatter, props, a hard value break
   into water. Two thirds of our frame is one untextured green.
3. The reference never lets two important things sit at the same value. Our navy
   birds sit within a few percent of the dark green props they cross.

Grades: player readability 2, enemy readability 3, ground 2, colour and light 3,
interface 5, "looks like a game" 2.

## Two corrections to the critic, both checked

**The outline exists.** The critic said nothing is outlined. Every creature
carries a baked inverted-hull outline, and a close frame shows it clearly. A
baked hull is geometry, so its width shrinks with distance, and at play zoom it
is under a pixel. The fix the critic asked for is the right one for a different
reason: the outline must be **screen-space at constant width**, not modelled.

**The missing HUD is a frame artefact, not a defect.** The critic judged a frame
with no health, timer or XP. That frame was taken at a stated size, and a stated
size leaves the interface layer out because it is laid out for the window. The
HUD exists and passes its own rulings. Do not rebuild it.

**The blown-out white on the player is the weapon, not the character.** It is the
claw dart's fire effect. It still erases the player's silhouette at the moment of
combat, which is most of the time, so it is a real defect — it belongs to effects,
not to the model.

## Confirmed defects, ranked by what they cost the eye

1. No screen-space outline on characters, enemies or pickups.
2. The player's silhouette is erased by its own weapon flash.
3. Enemies and props share a value band, so an enemy crossing a prop disappears.
4. The ground is one flat fill over most of the frame.
5. No contact shadow under movers; gems read as floating.
6. The title screen is not torn down — the run plays underneath it. Verified from
   the engine, not the picture: `mode: play`, time advancing, nothing holding.
7. Menu backgrounds are crushed to near-black rather than blurred and desaturated.
8. The world edge is visible — the ground ends at a straight horizon.
9. Interface leakage: a duplicated clock chip, desktop key hints on a phone frame,
   upgrade glyphs that carry no meaning.
10. Enemy families are separated by scale more than by silhouette.

## Engine faults found and fixed during the loop

Twelve. The two that would have cost the most:

- `agent.merge` matched the **first** registry entry with a lane's id, so a run id
  reused from an earlier session returned `already: true` and silently skipped the
  merge. A finished lane reported as landed with its branch unmerged.
- `tests.run` exited 0 with failing tests, so the release gate passed any lane
  that ran its checks at all.

Also: `engine.run` did not await async commands, so every measurement answered
`undefined`; `see.capture` drew only the GL canvas, so no frame ever showed the
interface; capture could only draw at the window's shape, so a phone game was
measured on an ultra-wide frame; `boxesTouch` used a strict comparison, so a thing
standing on the floor reported not touching.
