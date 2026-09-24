<!--829a26e8-->
parsed from source
  plugin Projectiles
  category game
  needs Health
  commands projectiles.list
  projectiles.clear
  arguments projectiles.list:;projectiles.clear:
  context projectiles
  systems fixed
  listens level:loaded
  emits weapon:fired {entity, origin, direction, weapon, projectile}
  weapon:hit {entity, target, point, normal, weapon}
  projectile:ended {entity, why, weapon}
  source 294 lines
