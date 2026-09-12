## Output

```
<output>/
  kit/                one .py and one .blend per reused part, plus _common.py
  checks.py           the audits, the cameras, the gate renders
  build.py            the scene: terrain, links the kit, places instances
  iterations/
    pass-1/           plan view, the walk, depth-layer render, landmark, squint
    pass-2/  pass-3/   the same, plus one gameplay frame per play area
    edit-1/ ...
    iterations.md     one block per pass
  friction-log.md
```

Every gate writes to `iterations.md`: **three lists** - in the reference or the
brief and missing from yours; in yours and in neither; in both but wrong.
Forms and places, not adjectives: "the reference puts the stairs on the far
side of the courtyard, mine are beside the gate" is actionable, "the layout is
off" is not. Then ten scores, one line of reasoning each.

| # | Row | Fail looks like |
|---|---|---|
| 1 | Read - would a stranger name this place unprompted? | needs the caption |
| 2 | Route - walking in, do you know where to go? | equal choices, nothing pulls |
| 3 | Framing - is the landmark staged from the entry? | visible but unstaged |
| 4 | Depth - near, middle and far, each its own grey? | a flat facade |
| 5 | Form fidelity - is each mass the shape the real thing is? Cite the silhouette numbers and name the worst masses | everything a box; a score that repeats last pass's with no measurement behind it |
| 6 | Human scale - right beside the 1.8 m figure, everywhere? | a room reading as a hangar |
| 7 | Playability - capsule, cover, stairs and gaps all legal? | a corridor you cannot walk |
| 8 | Pacing - does tight alternate with open? | one width throughout |
| 9 | Place - one world, era and maker? | parts from three games |
| 10 | Density - as busy as the reference, in the same places? | bare where the reference is busy |

Scores rank this pass against the last and nothing else. Model scores measured
1.5 to 6 points above a working artist's on the same builds; the *order* was
right every time.

Hand over the renders, the three lists, the three decisions from the top, and
what is not built. Close with `friction-log.md`: what you built by hand that
should have been one call, and which generators are worth keeping.
