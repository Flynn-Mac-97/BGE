<!--12fe950f-->
parsed from source
  plugin Experience
  category game
  commands experience.state
  experience.gain
  arguments experience.state:;experience.gain: args
  context experience
  listens level:loaded
  emits experience:levelled {level, source}
  experience:gained {points, source, level}
  source 162 lines
