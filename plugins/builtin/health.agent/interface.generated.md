<!--487ee5fd-->
parsed from source
  plugin Health
  category game
  commands health.list
  health.damage
  health.give
  arguments health.list:;health.damage: args;health.give: args
  context damage, heal, health
  systems fixed
  listens entity:added, entity:removed, level:loaded
  emits entity:hurt
  entity:killed {victim, remaining}
  entity:healed {entity, amount, remaining}
  source 342 lines
