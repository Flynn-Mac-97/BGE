---
description: Counts experience points against a curve and announces every level gained. Use for XP, levelling, progression thresholds, and anything that must trigger once per level.
---

# Experience

- Counts experience points against a curve and announces every level gained.
- `context.experience.gain(amount, source)` is the only way points go in.
- `configure({ base, growth, maxLevel, curve })` sets the numbers. `curve(level)`
  is a function when a hand-tuned table beats a formula. The default,
  `base * level ** growth` with base 5 and growth 1.35, is fast then slow.
- Reads: `.level` `.intoLevel` `.needed` `.fraction` `.total` `.atMaximum`,
  and `needFor(level)` / `totalFor(level)`.
- Announces `experience:levelled` **once per level**, in order, even when one
  pickup crosses three thresholds — so a chooser can queue three offers.
  Also `experience:gained`.
- Mirrors `level`, `experience`, `experienceNeeded` and `experienceFraction`
  into `world.state`, so a HUD reads them with no wiring.
- Resets on `level:loaded`. A run's progress belongs to that run.
- Commands: `experience.state`, `experience.gain <n>`.
