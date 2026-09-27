<!--a67df06a-->
parsed from source
  plugin Auto Weapons
  category game
  needs Health
  commands weapons.carried
  weapons.give
  weapons.upgrade
  weapons.defined
  arguments weapons.carried:;weapons.give: args;weapons.upgrade: args;weapons.defined:
  context autoWeapons
  systems fixed
  listens entity:removed, level:loaded
  emits weapon:given {entity, weapon, stats}
  weapon:taken {entity, weapon}
  weapon:upgraded {entity, weapon, stats, changes}
  source 306 lines
