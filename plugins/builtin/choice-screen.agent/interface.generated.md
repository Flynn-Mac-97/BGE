<!-- Generated from plugins/builtin/choice-screen.js; sha256 4a8ef20274ccf869231725f397c63bc28ca81be35fccdc9a316f9f7517e9ee73. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/choice-screen.js). Where the prose below it disagrees, this is the code.

```
  plugin     Choice Screen
  category   game
  needs      Screen, Keyboard Input
  commands   choice.show (What is being offered)
             choice.pick (Take one of the offered cards)
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
