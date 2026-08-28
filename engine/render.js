/**
 * Kernel: one GL context, one draw order.
 *
 * 2D is an orthographic camera looking down -Z at textured planes. 3D is the
 * same scene with a perspective camera. One renderer, one scene graph, one
 * asset path — which is also why the editor only needs one picking implementation.
 */
import * as THREE from 'three'
import { assetURL } from './ui.js'

const loader = new THREE.TextureLoader()
const texCache = new Map()

function texture(src, onFail) {
  if (texCache.has(src)) return texCache.get(src)
  const url = assetURL(src)
  const t = loader.load(url, undefined, undefined, () => {
    // A texture that 404s used to mean a blank viewport and an empty error
    // log — the single worst thing to hand an agent. Say it out loud instead.
    console.error(`[render] missing texture ${url} (referenced as "${src}")`)
    t.userData.failed = true
    onFail?.()
  })
  // pixel art stays crisp: no smoothing, no mipmaps
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.colorSpace = THREE.SRGBColorSpace
  texCache.set(src, t)
  return t
}

/**
 * How big an entity draws.
 *
 * The sprite wins over the collider, because art is usually larger than the box
 * it collides with — a character's hair should not be part of its hitbox. The
 * collider is the fallback so an untextured entity still has an honest size,
 * and a circle reports its diameter rather than silently becoming 1x1.
 */
function drawSize(e) {
  const s = e.scale ?? 1
  const d = e.collider?.circle ? e.collider.circle * 2 : null
  return {
    w: (e.sprite?.width ?? e.collider?.box?.[0] ?? d ?? 1) * s,
    h: (e.sprite?.height ?? e.collider?.box?.[1] ?? d ?? 1) * s
  }
}

/**
 * Where frame N sits in a sheet, as a UV window.
 *
 * Frames run left to right then top to bottom, and the column count comes from
 * the image once it has loaded — declaring it as well would be a second source
 * of truth that could disagree with the file.
 */
function frameWindow(sprite, frame, image) {
  const [cw, ch] = sprite.size || [image.width, image.height]
  const cols = Math.max(1, Math.floor(image.width / cw))
  const rows = Math.max(1, Math.floor(image.height / ch))
  const n = Math.max(0, Math.floor(frame || 0)) % (cols * rows)
  return {
    repeat: [cw / image.width, ch / image.height],
    // Three's V axis runs bottom-up while a sheet reads top-down.
    offset: [(n % cols) * cw / image.width, 1 - ch / image.height - Math.floor(n / cols) * ch / image.height]
  }
}

/**
 * The image a sprite points at, whichever way it was written.
 *
 * `image` is one picture; `sheet` is a strip of same-sized frames. They are the
 * same file to the renderer — only how it maps UVs differs — so everything
 * downstream asks for `source()` and does not care which was declared.
 */
const source = s => s?.sheet || s?.image || null

/** Changes to this string mean the material has to be rebuilt, not just moved. */
const look = e => (source(e.sprite) ? `${source(e.sprite)}|${e.sprite.tile ?? 0}|${e.sprite.sheet ? 'sheet' : 'one'}` : `tint:${e.type}`)

/** Stable colour per type so untextured entities are still distinguishable. */
function tint(type) {
  let hash = 0
  for (let i = 0; i < type.length; i++) hash = (hash * 31 + type.charCodeAt(i)) | 0
  const c = new THREE.Color()
  c.setHSL(((hash >>> 0) % 360) / 360, 0.32, 0.55)
  return c
}

const PLANE = new THREE.PlaneGeometry(1, 1)

/**
 * `view` and `viewport` are handed in, not owned here.
 *
 * Where the camera looks and how big the picture is are game values — the
 * camera plugin moves one and clamps against the other — so they belong to the
 * session, which exists whether or not anything is drawing. The renderer reads
 * the same two objects the game does.
 */
export function makeRenderer(canvas, view, viewport) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
  camera.position.z = 10

  const meshes = new Map()   // entity id -> mesh

  function resize() {
    const r = canvas.getBoundingClientRect()
    viewport.width = Math.max(1, r.width)
    viewport.height = Math.max(1, r.height)
    renderer.setSize(viewport.width, viewport.height, false)
    updateCamera()
  }

  function updateCamera() {
    const hw = viewport.width / 2 / view.zoom
    const hh = viewport.height / 2 / view.zoom
    camera.left = -hw; camera.right = hw
    camera.top = hh;   camera.bottom = -hh
    camera.position.x = view.x
    camera.position.y = view.y
    camera.updateProjectionMatrix()
  }

  function material(e) {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      // Pixel art has hard edges, so a low cutoff removes the halo without
      // clipping a deliberately faded entity (the stack-picking preview).
      alphaTest: 0.1,
      // 2D is painter's order, set from z and list position in sync().
      depthTest: false
    })
    const src = source(e.sprite)
    if (src) {
      const base = texture(src, () => {
        // Fall back to the type tint so a broken reference is visible in the
        // viewport as a plain block rather than as nothing at all.
        mat.map = null
        mat.color = tint(e.type)
        mat.needsUpdate = true
      })
      if (base.userData.failed) {
        mat.color = tint(e.type)
        return mat
      }
      // Tiled and sheet sprites both need their own texture: repeat and offset
      // live on the texture, and two entities showing different frames of the
      // same sheet must not share one.
      const own = e.sprite.tile || e.sprite.sheet
      mat.map = own ? base.clone() : base
      if (e.sprite.tile) {
        mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping
      }
      if (own) mat.map.needsUpdate = true
    } else {
      mat.color = tint(e.type)
    }
    return mat
  }

  function meshFor(e) {
    let m = meshes.get(e.id)
    const key = look(e)

    if (m) {
      // Changing a sprite in the inspector has to show up without a reload.
      if (m.userData.look !== key) {
        m.material.dispose()
        m.material = material(e)
        m.userData.look = key
      }
      return m
    }

    m = new THREE.Mesh(PLANE, material(e))
    m.userData.entity = e.id
    m.userData.look = key
    scene.add(m)
    meshes.set(e.id, m)
    return m
  }

  return {
    // Both are the session's objects, re-exposed so existing plugins that reach
    // for renderer.view keep working.
    view,
    get size() { return { w: viewport.width, h: viewport.height } },
    scene,
    camera,

    resize,

    /** Push entity state into the scene graph. Called every frame. */
    sync(world) {
      const live = new Set()
      world.entities.forEach((e, i) => {
        live.add(e.id)
        const m = meshFor(e)
        const { w, h } = drawSize(e)
        m.position.set(e.x, e.y, e.z || 0)
        m.rotation.z = (e.rotation || 0) * Math.PI / 180
        m.scale.set(w, h, 1)
        m.visible = !e.hidden
        m.material.opacity = e.opacity ?? 1
        // Depth testing is off, so draw order is the layering: z first, then
        // the order the level lists them in.
        m.renderOrder = (e.z || 0) * 1000 + i

        // A tiled sprite repeats once per world unit unless told otherwise.
        if (e.sprite?.tile && m.material.map) {
          m.material.map.repeat.set(w / e.sprite.tile, h / e.sprite.tile)
        }

        // A sheet shows one cell. `e.frame` is set by whoever is animating it —
        // the animation plugin, or game code directly.
        const img = m.material.map?.image
        if (e.sprite?.sheet && img?.width) {
          const win = frameWindow(e.sprite, e.frame, img)
          m.material.map.repeat.set(win.repeat[0], win.repeat[1])
          m.material.map.offset.set(win.offset[0], win.offset[1])
        }

        // Facing is a mirror, not a rotation: negative X scale flips the art
        // without touching the collider or the transform gizmo.
        if (e.flip) m.scale.x = -m.scale.x
      })
      for (const [id, m] of meshes) {
        if (live.has(id)) continue
        scene.remove(m)
        m.material.dispose()
        meshes.delete(id)
      }
    },

    draw() {
      updateCamera()
      renderer.render(scene, camera)
    },

    // ---- coordinate helpers, used by every viewport tool ----
    toScreen(x, y) {
      return {
        x: (x - view.x) * view.zoom + viewport.width / 2,
        y: viewport.height / 2 - (y - view.y) * view.zoom
      }
    },
    toWorld(px, py) {
      return {
        x: (px - viewport.width / 2) / view.zoom + view.x,
        y: view.y - (py - viewport.height / 2) / view.zoom
      }
    },

    /** Every entity under a screen point, front to back. */
    pick(world, px, py) {
      const p = this.toWorld(px, py)
      const hits = world.entities.filter(e => {
        const { w, h } = drawSize(e)
        const a = -(e.rotation || 0) * Math.PI / 180
        const dx = p.x - e.x, dy = p.y - e.y
        const lx = dx * Math.cos(a) - dy * Math.sin(a)
        const ly = dx * Math.sin(a) + dy * Math.cos(a)
        return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2
      })
      return hits.reverse()
    },

    bounds: drawSize,

    /**
     * Drop a cached texture so the next draw re-fetches it.
     *
     * Textures are cached by name for the life of the page, which is right
     * until someone edits the image — then the cache is the reason the change
     * appears to do nothing.
     */
    forget(file) {
      const name = file.replace(/^assets\//, '')
      for (const key of [file, name]) texCache.delete(key)
      for (const [id, m] of meshes) {
        // Force a rebuild on the next sync by invalidating the look key.
        m.userData.look = null
        void id
      }
    }
  }
}
