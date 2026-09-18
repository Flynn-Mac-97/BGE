<!-- Generated from plugins/builtin/choice-screen.js; sha256 8bacd740c7c78946ee0e3583ede915bbd206cb6ed556301f6cb28905166f5b13. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/choice-screen.js). Where the prose below it disagrees, this is the code.

```
  plugin     Choice Screen
  category   game
  needs      Screen, Keyboard Input
  commands   choice.show (Offered cards)
             choice.pick (Pick a card)
  arguments  choice.show: none
  arguments  choice.pick: args
  context    context.choiceScreen
  systems    fixed
  listens    level:loaded, play:stopped, step:end
  emits      choice:closed
             choice:offered {title, options}
             choice:picked {option, index, title}
  source     258 lines
```
