<!-- Generated from plugins/builtin/projectiles.js; sha256 d15532a9137e43b502ea03e22dbbfb266ed70aff76c54775bc1233fdac8f13a7. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/projectiles.js). Where the prose below it disagrees, this is the code.

```
  plugin     Projectiles
  category   game
  needs      Health
  commands   projectiles.list (What is in the air)
             projectiles.clear (Take every shot out of the air)
  arguments  projectiles.list: none
  arguments  projectiles.clear: none
  context    context.projectiles
  systems    fixed
  listens    level:loaded
  emits      weapon:fired {entity, origin, direction, weapon, projectile}
             weapon:hit {entity, target, point, normal, weapon}
             projectile:ended {entity, why, weapon}
  source     294 lines
```
