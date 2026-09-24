<!--8e9bbbe3-->
parsed from source
  plugin Choice Screen
  category game
  needs Screen, Keyboard Input
  commands choice.show
  choice.pick
  arguments choice.show:;choice.pick: args
  context choiceScreen
  systems fixed
  listens level:loaded, play:stopped, step:end
  emits choice:closed
  choice:offered {title, options}
  choice:picked {option, index, title}
  source 258 lines
