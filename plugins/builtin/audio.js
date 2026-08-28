/**
 * Sound — sound, without breaking anything the engine promises.
 *
 * Declared in the type file next to the behaviour that triggers it:
 *
 *   sounds: { jump: 'jump.wav', hurt: 'hurt.wav' }
 *
 * Played by name from a hook:
 *
 *   context.play('jump')                       // this entity's sound
 *   context.play('coin.wav', { volume: 0.4 })  // or any file
 *
 * Two things make this an engine feature rather than a wrapper around Audio():
 *
 * 1. Sound is a side effect, so it must never influence the simulation. It is
 *    fired from hooks but nothing about it feeds back into world state.
 *
 * 2. Every play is *recorded* whether or not it is audible. In a headless
 *    simulate() nothing comes out of the speakers, but `engine.sounds()` still
 *    reports that the jump sound played at t=0.35 — so "did the coin make a
 *    noise" is a question an agent can answer without listening.
 */
const RING = 60

export default {
  name: 'Sound',

  onLoad(context) {
    const buffers = new Map()   // file -> AudioBuffer
    const played = []           // recent plays, for inspection
    let audio = null            // AudioContext, created on first gesture
    let muted = false

    /**
     * Browsers refuse to start audio before the user interacts with the page.
     * Rather than fail the first sound, create the context lazily on the first
     * real gesture — and keep recording plays either way.
     */
    const wake = () => {
      if (!audio) {
        try { audio = new AudioContext() } catch { return null }
      }
      if (audio.state === 'suspended') audio.resume()
      return audio
    }
    addEventListener('pointerdown', wake, { once: false })
    addEventListener('keydown', wake, { once: false })

    async function buffer(file) {
      if (buffers.has(file)) return buffers.get(file)
      const a = wake()
      if (!a) return null
      const url = '/project/' + (file.includes('/') ? file : 'assets/' + file)
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        const decoded = await a.decodeAudioData(await res.arrayBuffer())
        buffers.set(file, decoded)
        return decoded
      } catch (e) {
        // Same rule as a missing texture: say so, do not fail silently.
        console.error(`[audio] cannot load ${url} — ${e.message}`)
        buffers.set(file, null)
        return null
      }
    }

    /**
     * @param name  a key in the entity's `sounds`, or a filename
     * @param options  { volume, rate, entity }
     */
    function play(name, options = {}) {
      const file = resolve(name, options.entity)
      const record = {
        t: round(context.time), name, file,
        volume: options.volume ?? 1,
        rate: options.rate ?? 1,
        audible: !muted && !!audio
      }
      played.push(record)
      if (played.length > RING) played.shift()
      context.bus.emit('sound:played', record)

      if (muted || !file) return record

      // Fire and forget. Nothing awaits this, so a slow decode can never stall
      // a fixed step.
      buffer(file).then(buf => {
        const a = audio
        if (!buf || !a) return
        const src = a.createBufferSource()
        src.buffer = buf
        src.playbackRate.value = record.rate
        const gain = a.createGain()
        gain.gain.value = record.volume
        src.connect(gain).connect(a.destination)
        src.start()
      })
      return record
    }

    /** A name resolves against the entity's own `sounds` first, then as a file. */
    function resolve(name, entity) {
      const table = entity?._definition?.sounds
      if (table && table[name]) return table[name]
      if (/\.(wav|mp3|ogg)$/i.test(name)) return name
      // Any type may name it — useful for shared sounds like a UI blip.
      for (const [, definition] of context.world.types) {
        if (definition.sounds?.[name]) return definition.sounds[name]
      }
      return null
    }

    // Loading a level starts a new run, so the record of what has been heard
    // starts again with it. Otherwise "what sounds played" answers with the
    // previous playthrough, timestamps and all.
    context.bus.on('level:loaded', () => { played.length = 0 })

    context.play = play
    context.audio = {
      play,
      get muted() { return muted },
      mute(on = true) { muted = on },
      recent: (n = 20) => played.slice(-n),
      loaded: () => [...buffers.keys()]
    }

    // Hooks get `context`, and an entity playing its own sound should not have to
    // pass itself. `context.play` bound to an entity is what types actually use.
    context.bus.on('entity:added', e => {
      if (e._definition.sounds) e.play = (name, options) => play(name, { ...options, entity: e })
    })
  },

  commands: [
    {
      id: 'audio.recent',
      label: 'Sounds played recently',
      run: context => context.audio.recent()
    },
    {
      id: 'audio.mute',
      label: 'Mute or unmute',
      run: (context, on) => { context.audio.mute(on ?? !context.audio.muted); return { muted: context.audio.muted } }
    }
  ]
}

const round = n => Math.round(n * 1000) / 1000
