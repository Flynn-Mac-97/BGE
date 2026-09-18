<!-- Generated from plugins/builtin/projectiles.js; sha256 787499088cafb97de55b5b120906ffc1b9b7ca4a72c193e2cbe800d39ef4cba8. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/projectiles.js). Where the prose below it disagrees, this is the code.

```
  plugin     Projectiles
  category   game
  needs      Health
  commands   projectiles.list (What is in the air)
             projectiles.clear (Clear shots)
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
