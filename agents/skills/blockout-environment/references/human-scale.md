# Human scale for playable space

Grep this file; do not read it whole. Every number is metres unless it says
otherwise, and every one is a starting point to be confirmed against the game
you are actually building. What matters more than any single figure is that
you write yours down at the top of the run and hold them, because a level
built to two different scales cannot be fixed later.

## Contents

- [The body](#the-body)
- [Game inflation, by camera](#game-inflation-by-camera)
- [Openings, rooms and circulation](#openings-rooms-and-circulation)
- [Vertical: steps, stairs, ramps, ledges](#vertical-steps-stairs-ramps-ledges)
- [Cover and combat space](#cover-and-combat-space)
- [Distance, speed and pacing](#distance-speed-and-pacing)
- [Engine unit tables](#engine-unit-tables)

## The body

| Thing | Size | Note |
|---|---|---|
| adult figure, the scene anchor | 1.8 tall | put it in with the first mass and never remove it |
| eye height, standing | 1.6-1.7 | the height every first-person frame is judged at |
| eye height, crouched | 0.9-1.1 | what a player sees over crouch cover |
| shoulder width | 0.45-0.5 | real; a game capsule is wider |
| player capsule, radius | 0.3-0.45 | the collision cylinder, not the model |
| player capsule, height | 1.75-1.9 standing, 0.9-1.1 crouched | crouch height sets every duct and vent |
| reach up, standing | 2.2 | ledge grab, top shelf, high hold |
| comfortable step over | 0.3-0.45 | above this the player must jump |

## Game inflation, by camera

Real interiors play cramped. These are multipliers on real architecture, and
they are the standard rather than a cheat.

| Camera | Corridor | Ceiling | Doorway | Why |
|---|---|---|---|---|
| first person | x1.5 | x1.3 | x1.3 | the model has no visible body, but the capsule does |
| third person | x2.0 | x1.6 | x1.5 | the camera arm needs room behind and above the player |
| isometric / top-down | x1.5-2.0 in plan | irrelevant, near walls are cut | x1.5 | the read is the floor, so the floor must be legible |
| side-scroller | lane depth is free | x1.5 | x1.5 | one plane, so give it air |

## Openings, rooms and circulation

| Thing | Real | Typical game | Note |
|---|---|---|---|
| door leaf | 0.9 x 2.0 | 1.2 x 2.4 | a real door is a shoulder-scrape in first person |
| double door, main entrance | 1.8 x 2.1 | 2.4 x 3.0 | the one a squad comes through |
| corridor, one person | 1.2 | 2.0-2.5 first person, 3.0-4.0 third person | below 1.5 the camera fights the walls |
| corridor, two abreast | 1.8 | 3.0-4.0 | AI companions need this or they shove you |
| ceiling, house | 2.4 | 3.0-3.5 | |
| ceiling, hall or public room | 3.5-5.0 | 5.0-8.0 | |
| ceiling, industrial | 6.0-12.0 | as real | this is where real life is already generous |
| room, small (bedroom, office) | 3 x 4 | 4 x 5 | |
| room, fightable | - | 8 x 8 minimum | anything smaller is a corridor with corners |
| window sill height | 0.9 | 1.0-1.1 | matches crouch cover, usefully |
| balcony rail | 1.0-1.1 | 1.1 | a rail at 1.4 hides the player's own feet |
| street, narrow lane | 3-4 | 5-6 | |
| street, urban with pavements | 10-14 | 12-18 | |
| courtyard that reads as a place | - | 15-30 across | smaller reads as a light well |

## Vertical: steps, stairs, ramps, ledges

| Thing | Real | Typical game | Note |
|---|---|---|---|
| stair riser | 0.17-0.19 | 0.2-0.3 | engines auto-step, so game stairs can be coarse |
| stair tread | 0.25-0.30 | 0.3 | |
| stair pitch | 30-35 degrees | up to 45 | steeper than 45 plays as a wall |
| auto step-up height | - | 0.3-0.45 | anything below this is invisible to the player |
| ledge, climbable with a jump | - | 0.9-1.2 | |
| ledge, needs a mantle or a boost | - | 1.5-2.2 | |
| ledge, hard wall | - | over 2.5 | make it obviously over 2.5, never 1.7 |
| ramp, comfortable | - | 15-25 degrees | |
| walkable slope limit | - | 35-45 degrees | over this is terrain that gates the player |
| floor-to-floor, building | 3.0-3.5 | 4.0-4.5 | with the ceiling inflation above |
| ladder rung spacing | 0.3 | 0.3 | |

**The rule that matters most:** a level change is either clearly climbable or
clearly not. A 1.7 m ledge that the player can *nearly* get onto is the worst
object in level design, because every player will spend thirty seconds proving
it is not a route.

## Cover and combat space

| Thing | Height | Note |
|---|---|---|
| crouch cover | 1.0-1.2 | shoot over it standing, hide behind it crouched |
| waist cover | 1.2-1.4 | vaultable; a chest-high wall is the shooter's staple |
| full cover | 2.0-2.2 | breaks the sightline completely |
| dead zone | 1.5-1.9 | neither cover nor wall, avoid it |
| cover width, one player | 1.0 minimum | thinner and you get shot round both sides |
| cover depth | 0.5 minimum | thin slivers read as noise and play badly |
| gap between cover, crossable | 4-8 | how far a player is exposed while moving |
| grenade-safe spacing | 6-10 | cover clumps closer than this die together |

## Distance, speed and pacing

| Thing | Value | Note |
|---|---|---|
| walk speed | 1.4-2.0 m/s | |
| run speed, shooter | 4.5-6.5 m/s | Source-family ~4.8, Unreal default ~6 |
| sprint | 6-9 m/s | |
| sightline, comfortable engagement | 15-30 m | |
| sightline, sniper lane | over 40 m | a decision, never an accident |
| landmark spacing, open world | 100-200 m | further and the walk is empty |
| spawn to first contact, competitive | state it in seconds | distance / run speed; balance these, or unbalance them on purpose |

## Engine unit tables

Confirm against your project settings - these are the defaults, and projects
change them.

### Source (Hammer: CS, TF2, Half-Life)

| Thing | Units | Metres |
|---|---|---|
| 1 unit | - | 0.01905 (16 units = 1 foot) |
| player, standing | 72 | 1.37 |
| player, crouched | 36 | 0.69 |
| eye height, standing | 64 | 1.22 |
| player hull width | 32 | 0.61 |
| step height (`sv_stepsize`) | 18 | 0.34 |
| run speed | 250 units/s | 4.76 m/s |
| grid ladder designers use | 16 / 32 / 64 / 128 / 256 | 0.3 / 0.6 / 1.2 / 2.4 / 4.9 |

Source players are famously short relative to the world, which is why Source
levels measure large in metres and still feel right.

### Unreal

| Thing | Default | Note |
|---|---|---|
| 1 unreal unit (uu) | 1 cm | |
| character capsule half-height | 88 uu | so 1.76 m tall |
| character capsule radius | 34 uu | |
| max step height | 45 uu | 0.45 m |
| walkable floor angle | ~44.8 degrees | |
| max walk speed | 600 uu/s | 6 m/s |
| jump Z velocity | 420 uu/s | clears about 0.9 m at default gravity |
| grid snapping designers use | 10 / 50 / 100 / 500 | |

### Unity

| Thing | Convention |
|---|---|
| 1 unit | 1 m, by near-universal convention |
| standard capsule | 2.0 tall, 0.5 radius |
| grid ladder | 0.25 / 0.5 / 1 / 2 / 4 |

Unity fixes nothing for you: the character controller's slope limit, step
offset and height are all project settings. Write yours down.
