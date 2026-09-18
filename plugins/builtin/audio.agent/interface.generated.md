<!-- Generated from plugins/builtin/audio.js; sha256 d87061a5487acc8919cfacde23a2ffac7f082739ff30bc5df9cfd8a73f44dd9e. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/audio.js). Where the prose below it disagrees, this is the code.

```
  plugin     Sound
  category   engine
  commands   audio.recent (Recent sounds)
             audio.mute (Mute or unmute)
  arguments  audio.recent: none
  arguments  audio.mute: on
  context    context.audio, context.play
  listens    entity:added, level:loaded
  emits      sound:played
  source     167 lines
```
