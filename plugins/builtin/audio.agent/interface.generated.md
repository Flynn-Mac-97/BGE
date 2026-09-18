<!-- Generated from plugins/builtin/audio.js; sha256 db0bbbf020c7ff7637be559ff1de9134aec7409ce221d9c514a9068f626cbe16. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/audio.js). Where the prose below it disagrees, this is the code.

```
  plugin     Sound
  category   engine
  commands   audio.recent (Sounds played recently)
             audio.mute (Mute or unmute)
  arguments  audio.recent: none
  arguments  audio.mute: on
  context    context.audio, context.play
  listens    entity:added, level:loaded
  emits      sound:played
  source     167 lines
```
