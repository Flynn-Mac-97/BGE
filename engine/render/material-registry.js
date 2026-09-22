/**
 * Kernel: what a surface is made of, contributed by plugins.
 *
 * The two built-ins go through the same door as a plugin's, because a hook
 * point only one side can use is not a hook point. Registering a builder
 * replaces every built material, so a plugin that loads after a level still
 * takes effect.
 */
import * as THREE from 'three/webgpu'
import { uv as uvAttribute } from 'three/tsl'
import {
  declaredNumber, meshOf, meshShape, tilingOf, materialNameFor, spriteSource
} from '../frame-plan.js'
import { readColour } from './read-value.js'
import { entityTint } from './entity-look.js'
import { UNIT_PLANE, solidGeometry } from './geometry-cache.js'
import { cachedTexture, tiledTexture, privateTexture, textureStatus } from './texture-cache.js'
import { reportOnce } from './report.js'

export function makeMaterialRegistry(state) {
  /**
   * What a surface is made of, contributed by plugins.
   *
   * `build({ mesh, texture, tint, view, uv })` returns a THREE.Material, where
   * `mesh` is the whole normalised declaration (so a plugin can read its own
   * keys off it), `texture` is the resolved map or null, `tint` is always a
   * Colour and is what `color` should be, `view` is the session's camera state
   * for a material that needs to know where the eye is, and `uv` is the two
   * coordinate sets below.
   *
   * The two built-ins go through the same door, because a hook point only one
   * side can use is not a hook point. `lambert` is the default and it is what
   * everything drew with before this existed, so nothing breaks when no plugin
   * has registered anything.
   */
  /**
   * The two UV sets, named, for a node shader.
   *
   * Reaching for three's `uv()` here gets metres, not the 0..1 every shader
   * tutorial assumes, and the shader is then silently wrong. Ask by what the
   * number means instead.
   *
   * - `face()` — 0 to 1 across this face. Borders, radial falloffs, ramps:
   *   anything measured against the face rather than against the world.
   * - `metres()` — one unit is one metre of surface, whatever the face's size.
   *   A pattern that must stay the same size on a puddle and on a lake.
   *
   * See `measureUVsInMetres` for why the metres are in the first set.
   */
  const UV = { face: () => uvAttribute(1), metres: () => uvAttribute() }

  const materialBuilders = new Map()
  const sharedMaterials = new Map()

  materialBuilders.set('lambert', ({ texture: map, tint: colour }) =>
    new THREE.MeshLambertMaterial({
      map: map || null, color: colour, depthTest: true, depthWrite: true, side: THREE.FrontSide
    }))

  materialBuilders.set('basic', ({ texture: map, tint: colour }) =>
    new THREE.MeshBasicMaterial({
      map: map || null, color: colour, depthTest: true, depthWrite: true, side: THREE.FrontSide
    }))

  /**
   * Force every object to be rebuilt on the next sync.
   *
   * A texture that 404s arrives long after the materials that wanted it were
   * built, and those materials are shared, so there is no one mesh to patch.
   * Rebuilding is both simpler and correct: the second time round the file is
   * known to have failed, so the fallback colour is chosen up front. It cannot
   * loop, because a failed texture is never asked to report again.
   */
  function invalidateEverything() {
    sharedMaterials.clear()
    for (const object of state.meshes.values()) {
      object.userData.look = null
      const record = object.userData.record
      if (record) record.drawnLook = null
    }
  }

  /**
   * The material for solid geometry, shared by every mesh that looks the same.
   *
   * Lambert rather than Standard: Counter-Strike 1.6 was lightmapped and flat
   * lit, so a diffuse-only response reads closer to it than a physically-based
   * one does, at a fraction of the cost on a map made of several hundred boxes.
   * `unlit: true` drops to Basic for anything that supplies its own light —
   * a skybox face, a lamp, a screen. Either way it is opaque, writes and tests
   * depth and culls its back faces, which is what lets a room be drawn from the
   * inside with nothing sorted.
   */
  /** The material inputs one mesh declaration asks for, and the texture they tile. */
  function meshMaterialInputs(entity, declared, where, part) {
    const declaredColour = readColour(declared.tint, `${where}.tint`)
    const [u, v] = tilingOf(declared.tiling, part ? part.shape : meshShape(entity), `${where}.tiling`)

    let map = null
    if (declared.texture && textureStatus(declared.texture, 'world') !== 'failed') {
      map = tiledTexture(declared.texture, 'world', u, v, invalidateEverything)
    }
    // Only a declared tint multiplies into a texture. Falling back to the
    // per-type colour there would wash every textured wall a different shade.
    const colour = declaredColour || (map ? new THREE.Color(0xffffff) : entityTint(entity.type))
    return { map, colour }
  }

  function meshMaterial(entity, key, part = null) {
    const cached = sharedMaterials.get(key)
    if (cached) return cached

    // A part is a small mesh declaration of its own, already merged with the
    // mesh's shared keys, so everything below reads it exactly as it reads a
    // whole mesh — there is no second way to describe a surface.
    const declared = part ? part.declaration : meshOf(entity)
    const where = part ? `${entity.type}.mesh.parts[${part.index}]` : `${entity.type}.mesh`
    const { map, colour } = meshMaterialInputs(entity, declared, where, part)

    const name = materialNameFor(declared)
    const build = materialBuilders.get(name)
    if (!build) reportOnce(`[render] ${where}.material: no material named "${name}" is registered — using lambert`)
    const material = (build || materialBuilders.get('lambert'))({
      mesh: declared, texture: map, tint: colour, view: state.view, uv: UV
    })

    applyLightmap(material, declared, where)
    sharedMaterials.set(key, material)
    return material
  }

  /**
   * Baked light, on the second UV set.
   *
   * Where the light in a room comes from is a level's business, but which UV
   * channel carries it is the renderer's — three defaults a lightmap to channel 0,
   * which is the tiling set, and the result is a lightmap repeated once per
   * metre and nobody able to say why. Generated boxes get their second set from
   * `solidGeometry()`; a model brings whatever its file declared.
   */
  function applyLightmap(material, declared, where) {
    if (!declared.lightmap) return
    if (!('lightMap' in material)) {
      reportOnce(`[render] ${where}.lightmap: a "${materialNameFor(declared)}" material has no lightmap slot`)
      return
    }
    if (textureStatus(declared.lightmap, 'lightmap') === 'failed') return
    const baked = cachedTexture(declared.lightmap, 'lightmap', invalidateEverything)
    baked.channel = 1
    material.lightMap = baked
    material.lightMapIntensity = declaredNumber(declared.lightmapIntensity, 1, `${where}.lightmapIntensity`)
  }

  /** The unlit, painter-ordered material a sprite draws with, tinted when its file cannot be read. */
  function spriteMaterial(entity) {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      // Pixel art has hard edges, so a low cutoff removes the halo without
      // clipping a deliberately faded entity (the stack-picking preview).
      alphaTest: 0.1,
      // 2D is painter's order, set from z and list position in sync(). In a
      // first-person scene sync() turns testing back on, or a sprite would
      // float in front of a wall it is standing behind.
      depthTest: false
    })
    const src = spriteSource(entity.sprite)
    if (!src || textureStatus(src, 'sprite') === 'failed') {
      mat.color = entityTint(entity.type)
      return mat
    }
    // Tiled and sheet sprites both need their own texture: repeat and offset
    // live on the texture, and two entities showing different frames of the
    // same sheet must not share one.
    const own = entity.sprite.tile || entity.sprite.sheet
    const onFail = () => {
      // Fall back to the type tint so a broken reference is visible in the
      // viewport as a plain block rather than as nothing at all.
      mat.map = null
      mat.color = entityTint(entity.type)
      mat.needsUpdate = true
    }
    mat.map = own ? privateTexture(src, 'sprite', onFail) : cachedTexture(src, 'sprite', onFail)
    if (entity.sprite.tile) mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping
    return mat
  }

  /** The shared geometry an entity's declared shape asks for: its plane, box or sphere. */
  const geometryFor = entity => {
    const shape = meshShape(entity)
    if (!shape) return UNIT_PLANE
    const kind = shape.kind === 'quad' || shape.kind === 'sphere' ? shape.kind : 'box'
    return solidGeometry(kind, shape.w, shape.h, shape.d, shape.segments)
  }

  /**
   * What a surface can be made of. `mesh.material` picks one by name.
   *
   * Registering replaces every built material, because a plugin that loads
   * after a level would otherwise have no effect until something happened to
   * change a look — a hook that works only if you got the order right is worse
   * than no hook.
   */
  const materials = {
    register(name, build) {
      if (typeof name !== 'string' || !name || typeof build !== 'function') {
        reportOnce(`[render] materials.register: needs a name and a build function, got ${JSON.stringify(name)}`)
        return
      }
      materialBuilders.set(name, build)
      invalidateEverything()
    },
    has: name => materialBuilders.has(name),
    get names() { return [...materialBuilders.keys()] }
  }

  state.invalidateEverything = invalidateEverything
  state.meshMaterial = meshMaterial
  state.spriteMaterial = spriteMaterial
  state.geometryFor = geometryFor
  state.materials = materials
  state.materialCount = () => sharedMaterials.size
}
