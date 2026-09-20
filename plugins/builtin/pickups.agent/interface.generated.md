<!--5adf74a5-->
parsed from source
  plugin Pickups
  category game
  commands pickups.list
  pickups.attract
  arguments pickups.list:;pickups.attract:
  context pickups
  systems fixed
  listens level:loaded
  emits pickup:collected {entity, collector, kind, value}
  pickup:latched {entity, collector}
  source 209 lines
