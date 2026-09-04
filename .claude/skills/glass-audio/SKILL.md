---
name: glass-audio
description: Play sound — effects a type declares and the game triggers by name. Use when adding a sound effect, music, a footstep or a weapon noise, or when something should be audible and is not.
---
<!-- generated from plugins/builtin/audio.agent.md at server start; edits are lost -->

# Sound

- Plugin name is **Sound**; the file is `audio.js` and the context key is `context.audio`.
- A type declares what it can make a noise with; game code plays one by name:

```js
// project/types/player.js
sounds: { jump: 'jump.wav', hurt: 'hurt.wav' }

// in a hook
context.play('jump', { entity })          // this entity's table first
entity.play('jump')                       // same thing, bound — only on types that declare `sounds`
context.play('coin.wav', { volume: 0.4 }) // any file, no table needed
```

`context.play(name, options)` returns the record it made, always — even muted, even with no file behind it.

| option | default | meaning |
|---|---|---|
| `volume` | `1` | gain, multiplied straight onto the buffer source |
| `rate` | `1` | playback rate. Pitch and speed together |
| `entity` | none | whose `sounds` table to read `name` from first |

A name resolves in three steps: the entity's own `_definition.sounds`, then as a filename if it ends `.wav` `.mp3` `.ogg`, then any loaded type's `sounds`. Unresolved is recorded with `file: null` and makes no noise.

| record field | meaning |
|---|---|
| `t` | `context.time` when it played, to 3 decimals |
| `name` `file` | what was asked for, and what it resolved to |
| `volume` `rate` | as passed |
| `audible` | false when muted, and false in a headless run — the play is still recorded |

- `context.audio`: `play` · `mute(on = true)` · `muted` · `recent(n = 20)` · `loaded()`.
- Commands: `audio.recent` · `audio.mute`.
- **Emits `sound:played`** with the record, on every play. Listens for `level:loaded` and clears the log, so "what played" answers about this run.
- The last **60** plays are kept. Older ones are dropped.
- The `AudioContext` is created on the first `pointerdown` or `keydown`, because browsers refuse audio before a gesture. Nothing before that is audible; all of it is recorded.
- Files resolve through `assetURL`, the same call the renderer uses for a texture. A file that will not load is reported once and cached as a miss.
- Nothing awaits a decode, so a slow file cannot stall a fixed step — and sound never feeds back into world state.
