/**
 * Damage Numbers — the figure that lifts off a hit and fades.
 *
 * This is most of why hitting something feels good. The hit itself is one frame
 * of white; the number is the part that says how much, stays long enough to
 * read, and stacks up into the sense that the build is working. A game can be
 * balanced perfectly and feel dead without it.
 *
 * A number is not an entity. It has no collider, nothing may target it, and a
 * hundred of them on screen at once is normal — so they are plain records in an
 * array, drawn as camera-facing quads the same way particles are. Making them
 * entities would put a hundred throwaway things in the Scene tree, which is
 * exactly the tree somebody is using to find the one enemy that will not die.
 *
 * The text is drawn into a small canvas once per distinct string and cached.
 * The strings are damage figures, so the cache is a few dozen entries wide even
 * in a long run, and it is capped in case a game shows something else.
 *
 * Headless keeps every record and draws none of them, so `damage.numbers` is a
 * real answer to "did that hit land, and for how much" with no screen at all.
 */

/** Live numbers, oldest first. Cleared on a level load with everything else. */
const rising = []

/**
 * How many have been shown this run.
 *
 * A number lives under a second, so counting what is in the air at the end of a
 * simulation answers zero even when hundreds were thrown. A headless run asking
 * "did the numbers happen" needs the total, not the survivors.
 */
let shown = 0

/** Past this, the oldest goes. A number nobody can read is not worth a draw call. */
const MOST = 240

/**
 * How a number behaves unless the caller says otherwise. Live, and published as
 * `context.damageNumbers.defaults`, because the right size is a fact about the
 * game's camera, not about this plugin: 0.55 m read fine at nine metres and was
 * six percent of the screen at fourteen. The automatic `entity:hurt` listener
 * goes through the same defaults, so a game sets them once and every number —
 * including the ones it never shows itself — comes out to its own scale.
 */
const defaults = {
  rise: 1.8,          // metres a second, up
  drift: 0.7,         // metres a second, sideways, so two hits do not stack
  life: 0.85,         // seconds
  size: 0.55          // metres tall
}

/** What an ordinary hit and a big one are coloured. */
const PLAIN = '#ffffff'
const CRITICAL = '#ffd23f'

let painter = null

const asVector = value => {
  if (Array.isArray(value)) return { x: +value[0] || 0, y: +value[1] || 0, z: +value[2] || 0 }
  if (value && typeof value === 'object') return { x: +value.x || 0, y: +value.y || 0, z: +value.z || 0 }
  return null
}

export default {
  name: 'Damage Numbers',
  category: 'game',
  about: 'The figure that lifts off a hit and fades — how much that did, said where it happened.',

  inspect: () => [{
    title: 'Damage Numbers',
    rows: [['rising', rising.length], ['shown', shown], ['drawn', painter ? 'yes' : 'no screen']]
  }],

  onLoad(context) {
    /**
     * Put one number in the air.
     *
     * @param how  at        where it starts
     *             text      what it says; a number is rounded for you
     *             colour    hex; white for a hit, gold for a big one
     *             size      metres tall, before any scaling for weight
     *             life      seconds
     *             rise      metres a second upward
     *             critical  true makes it bigger, golder and slower
     */
    function show(how = {}) {
      const at = asVector(how.at)
      if (!at) {
        console.error('[damage numbers] a number needs an "at" of { x, y, z } — nothing was shown')
        return null
      }
      const critical = how.critical === true
      const amount = Number(how.text)
      const record = {
        // A damage figure is read at a glance, so it is rounded — "17" and not
        // "17.4000000000002", which is what the arithmetic actually produces.
        text: Number.isFinite(amount) ? String(Math.max(1, Math.round(amount))) : String(how.text ?? ''),
        x: at.x,
        y: at.y,
        z: at.z,
        // Sideways drift comes out of the engine's own stream, so two runs of
        // the same fight scatter their numbers identically.
        driftX: context.random.range(-defaults.drift, defaults.drift),
        driftZ: context.random.range(-defaults.drift, defaults.drift),
        rise: Number(how.rise) || (critical ? defaults.rise * 1.25 : defaults.rise),
        colour: how.colour || (critical ? CRITICAL : PLAIN),
        size: (Number(how.size) || defaults.size) * (critical ? 1.45 : 1),
        life: Number(how.life) || (critical ? defaults.life * 1.3 : defaults.life),
        age: 0,
        critical
      }
      rising.push(record)
      shown++
      while (rising.length > MOST) rising.shift()
      return record
    }

    context.damageNumbers = {
      show,
      /** Set these once — `defaults.size = 1` — and every number follows, automatic ones included. */
      defaults,
      /** What is on screen right now, rounded — what a test compares. */
      rising: () => rising.map(record => ({
        text: record.text,
        at: [round(record.x), round(record.y), round(record.z)],
        left: round(record.life - record.age),
        critical: record.critical
      })),
      clear() { rising.length = 0 },
      count: () => rising.length,
      /** How many have been thrown this run, not how many are still in the air. */
      shown: () => shown
    }

    // Every hit, automatically. A game that wants to say something else — a
    // word, a heal in green — calls `show` itself and this still runs.
    context.bus.on('entity:hurt', event => {
      if (!(event?.dealt > 0)) return
      const point = asVector(event.point) || { x: event.entity.x, y: event.entity.y, z: event.entity.z }
      show({ at: { x: point.x, y: point.y + 0.4, z: point.z }, text: event.dealt, critical: event.critical })
    })

    context.bus.on('level:loaded', () => { rising.length = 0; shown = 0 })
    context.bus.on('shell:ready', () => attachDrawing(context))
  },

  systems: [
    {
      phase: 'fixed',
      run(world, seconds) {
        for (let i = rising.length - 1; i >= 0; i--) {
          const record = rising[i]
          record.age += seconds
          if (record.age >= record.life) { rising.splice(i, 1); continue }
          // Slowing as it goes, so it arrives rather than shooting off — the
          // same easing every game in the genre uses without ever saying so.
          const left = 1 - record.age / record.life
          record.y += record.rise * left * seconds
          record.x += record.driftX * left * seconds
          record.z += record.driftZ * left * seconds
        }
      }
    },
    {
      phase: 'frame',
      run: () => painter?.sync(rising)
    }
  ],

  commands: [
    {
      id: 'damage.numbers',
      label: 'Numbers in the air right now',
      run: context => context.damageNumbers.rising()
    },
    {
      id: 'damage.number',
      label: 'Show one number by hand',
      /** `run damage.number '[[0, 1, 0], 42]'` */
      run: (context, args) => {
        const [at, text, critical] = Array.isArray(args) ? args : [args, '', false]
        return context.damageNumbers.show({ at, text, critical: critical === true })
      }
    }
  ]
}

// ------------------------------------------------------------------ drawing
function attachDrawing(context) {
  if (painter || !context.renderer?.scene) return
  // On demand, for the same reason Particles does it: a headless world never
  // draws one of these and should not pay to parse a 3D library.
  import('three/webgpu')
    .then(THREE => { painter = makePainter(THREE, context.renderer.scene) })
    .catch(error => console.error(`[damage numbers] could not load three, so numbers are recorded but not drawn — ${error.message}`))
}

/** Pixels tall the glyphs are drawn at. Bigger than any number is shown, so it never softens. */
const GLYPH = 96

/**
 * One canvas per distinct string and colour.
 *
 * Damage figures repeat constantly — a weapon that does eleven does eleven
 * every time — so this cache is a few dozen entries in a long run. It is capped
 * anyway, because a game may put words through here and words do not repeat.
 */
function makeLabels(THREE) {
  const cache = new Map()
  const MOST_LABELS = 200

  return function label(text, colour) {
    const key = `${text}|${colour}`
    const found = cache.get(key)
    if (found) return found

    const canvas = document.createElement('canvas')
    const pad = GLYPH * 0.35
    const measure = canvas.getContext('2d')
    measure.font = `bold ${GLYPH}px system-ui, sans-serif`
    const width = Math.ceil(measure.measureText(text).width + pad * 2)
    canvas.width = Math.max(2, width)
    canvas.height = Math.ceil(GLYPH * 1.5)

    const paint = canvas.getContext('2d')
    paint.font = `bold ${GLYPH}px system-ui, sans-serif`
    paint.textAlign = 'center'
    paint.textBaseline = 'middle'
    // Drawn twice: a dark stroke under the fill, because a white number over a
    // pale floor is invisible exactly when the fight is going well.
    paint.lineWidth = GLYPH * 0.16
    paint.lineJoin = 'round'
    paint.strokeStyle = 'rgba(0, 0, 0, 0.85)'
    paint.strokeText(text, canvas.width / 2, canvas.height / 2)
    paint.fillStyle = colour
    paint.fillText(text, canvas.width / 2, canvas.height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const entry = { texture, aspect: canvas.width / canvas.height }
    if (cache.size >= MOST_LABELS) {
      const oldest = cache.keys().next().value
      cache.get(oldest)?.texture.dispose()
      cache.delete(oldest)
    }
    cache.set(key, entry)
    return entry
  }
}

/**
 * A pool of sprites, reused.
 *
 * A sprite per number, made and thrown away sixty times a second, is the kind
 * of allocation that shows up as a stutter exactly when the screen is busiest —
 * which in this genre is always.
 */
function makePainter(THREE, scene) {
  const label = makeLabels(THREE)
  const pool = []

  function sprite(index) {
    if (pool[index]) return pool[index]
    const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false })
    const made = new THREE.Sprite(material)
    // Above the world and above the particles, because a number that a puff of
    // smoke can hide is a number that arrives when it is no longer news.
    made.renderOrder = 10
    made.frustumCulled = false
    // HUD in the scene, not world — see.capture {"ui": false} hides these.
    made.userData.overlay = true
    scene.add(made)
    pool[index] = made
    return made
  }

  return {
    sync(live) {
      live.forEach((record, index) => {
        const drawn = sprite(index)
        const { texture, aspect } = label(record.text, record.colour)
        if (drawn.material.map !== texture) {
          drawn.material.map = texture
          drawn.material.needsUpdate = true
        }
        // Fades over the back half of its life only, so it is fully legible for
        // long enough to actually be read.
        const through = record.age / record.life
        drawn.material.opacity = through < 0.5 ? 1 : Math.max(0, 1 - (through - 0.5) * 2)
        // Popping in: a number that arrives at full size reads as a static
        // label, and one that grows into place reads as an impact.
        const pop = through < 0.12 ? 0.7 + (through / 0.12) * 0.3 : 1
        drawn.scale.set(record.size * aspect * pop, record.size * pop, 1)
        drawn.position.set(record.x, record.y, record.z)
        drawn.visible = true
      })
      for (let index = live.length; index < pool.length; index++) pool[index].visible = false
    }
  }
}

const round = n => Math.round(n * 1000) / 1000
