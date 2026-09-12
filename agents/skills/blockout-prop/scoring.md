# What to hand over, and how to score it

## Output

```
<output>/
  build.py            one re-runnable script, tiers in order
  iterations/
    pass-1/           silhouette, 64 px thumbnail, orthos, the ship camera
    pass-2/  pass-3/  (full only)
    edit-1/ ...       (full only)
    iterations.md     one block per pass
  friction-log.md
```

Every gate writes to `iterations.md`: **three lists** - in the reference and
missing from yours; in yours and not the reference; in both but wrong. Forms,
not adjectives: "the grille is eight slots, mine is four" is actionable, "the
grille is off" is not. Then ten scores, one line of reasoning each.

| # | Row | Fail looks like |
|---|---|---|
| 1 | Identity - would a stranger name it unprompted? | needs the caption |
| 2 | Function - can you tell how it is used, which end faces the user? | no front, no grip |
| 3 | Focus - one clear place the eye goes first? | everything equally busy |
| 4 | Depth - forms in front of and inside each other? | a flat facade |
| 5 | Form fidelity - each mass the shape the real thing is? | everything a box |
| 6 | Human anchoring - right size beside the figure? | a prop reading as furniture |
| 7 | Density - as many parts as the reference, in the same places? | bare where the reference is busy |
| 8 | Place - one world, era and maker? | parts from three objects |
| 9 | Mechanical truth - could a factory build it, a hand work it? | parts touching nothing |
| 10 | Thumbnail read - outline still names it at 64 px? | outline turns to a blob |

Scores rank this pass against the last and nothing else. Three builds scored by
the model, then blind by a working artist: 6.3 vs 0.4, 7.6 vs 6.1, 6.6 vs 3.9 -
the order right every time, the numbers 1.5 to 6 points high.

Hand over the renders, the three lists, the mode taken, and what is not built.
Close with `friction-log.md`: what you built by hand that should have been one
call, and which generators are worth keeping for the next prop.
