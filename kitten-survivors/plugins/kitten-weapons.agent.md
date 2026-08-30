# Kitten Weapons

- The four weapons and their numbers. Nothing reads input; every one fires itself.
- **Claw Dart** throws at the nearest enemy, slight homing, fans out when there is nothing to aim at.
- **Yarn Ball** spawns balls that orbit you for a while, hurting whatever enters the ring (once per third of a second each).
- **Purr Wave** sweeps a ring outward from where you stand; each enemy is hit once as the edge passes.
- **Hairball** is lobbed backwards over your shoulder, arcs, and bursts for area damage.
- **A run opens with Claw Dart and Purr Wave only.** `STARTERS`. Yarn Ball and
  Hairball are cards, so the first two level-ups change what a run looks like.
  `kitten.proof` arms all four, because a proof is about all of them.
- The kitten (`you`) is armed on `level:loaded`, not on play, so a headless simulation fires too.
- The same handler hands Run Clock a **lookup**, not a body. A retry reloads the
  level and replaces every entity, and a clock holding the old body ends the
  next run at 0:00.
- Every number is `weapon.stats` in `Auto Weapons`: `level damage cooldown count area speed duration pierce knockback`. Kitten Upgrades changes them with `context.autoWeapons.upgrade(you, 'claw dart', { damage: '+5' })` and this file needs no edit.
- A target is anything with `entity.damageable`, alive, that is not the player, the floor, a projectile or a yarn ball. Enemies are read off the world — nothing is imported from the horde lane. Set `properties.friendly = true` to be left alone.
- Orbits and waves are ticked by Kitten Rings, not by Projectiles — one goes round you and one is a growing circle.
- Check with `kitten.weapons`.
