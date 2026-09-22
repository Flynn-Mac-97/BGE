/**
 * Kernel: what the level says about light, fog and sky, and when a shadow map
 * needs redrawing.
 */
import * as THREE from 'three/webgpu'
import { readColour, readIntensity } from './read-value.js'
import { reportOnce } from './report.js'

export function makeLighting(state) {
  /**
   * Light exists before any level says a word about it.
   *
   * A level that forgets its `world` block should still be lit — a black
   * viewport with an empty error log is the worst thing this can hand anyone.
   * The defaults are dust2 light: a warm sun from above and behind, a cool
   * ambient standing in for bounce off the sky.
   */
  const DEFAULT_SUN = [-0.4, -1, -0.3]
  const ambient = new THREE.AmbientLight(new THREE.Color('#93a7c4'), 0.55)
  const sun = new THREE.DirectionalLight(new THREE.Color('#fff2d8'), 0.9)
  state.scene.add(ambient, sun)

  /**
   * Point the sun. A direction is where the light TRAVELS, so the lamp goes the
   * opposite way; the distance is arbitrary for a directional light, because
   * only the direction from it to its target is ever read.
   *
   * Anything that is not three usable numbers leaves the sun exactly where it
   * was and says so by name. Both halves of that matter: a sun at NaN lights
   * nothing and reports nothing, and a level that only wanted to change the
   * colour must not have its direction quietly reset underneath it.
   */
  function aimSun(direction) {
    if (direction === undefined || direction === null) return
    const given = Array.isArray(direction) ? direction.map(Number) : []
    if (given.length !== 3 || !given.every(Number.isFinite) || given.every(n => n === 0)) {
      reportOnce(`[render] setSun: ${JSON.stringify(direction)} is not a direction — leaving the sun where it is`)
      return
    }
    sun.position.set(given[0], given[1], given[2]).normalize().multiplyScalar(-50)
  }
  aimSun(DEFAULT_SUN)

  /**
   * Redraw a shadow map only when the things in it moved.
   *
   * Three draws every shadow map every frame. On a level that is almost all
   * static geometry under a fixed sun, the map changes only when a caster, a
   * light or its shadow camera moves, or when an object joins or leaves. Three
   * draws a map when `shadow.needsUpdate` is set and clears that itself, so
   * `autoUpdate` is turned off once and the flag is raised only on a changed
   * frame; a frame that changed nothing draws the map it already has.
   */
  /**
   * Whether the sun moved since the shadow map was drawn.
   */
  function sunMoved(light, remembered) {
    return remembered.shadowAtX !== light.position.x
      || remembered.shadowAtY !== light.position.y
      || remembered.shadowAtZ !== light.position.z
  }

  /** Whether the thing the sun points at moved. */
  function targetMoved(light, remembered) {
    const target = light.target
    if (!target) return false
    return remembered.shadowTargetX !== target.position.x
      || remembered.shadowTargetY !== target.position.y
      || remembered.shadowTargetZ !== target.position.z
  }

  /** Whether the shadow camera's box changed, which changes what the map covers. */
  function viewMoved(shadow, remembered) {
    const view = shadow.camera
    if (!view) return false
    return remembered.shadowLeft !== view.left
      || remembered.shadowRight !== view.right
      || remembered.shadowTop !== view.top
      || remembered.shadowBottom !== view.bottom
      || remembered.shadowNear !== view.near
      || remembered.shadowFar !== view.far
  }

  /** Whether the map was resized. */
  function mapSizeMoved(shadow, remembered) {
    return remembered.shadowWidth !== shadow.mapSize.width
  }

  /** Whether anything the map depends on moved. */
  function shadowMoved(light, shadow, remembered) {
    return sunMoved(light, remembered) || targetMoved(light, remembered)
      || viewMoved(shadow, remembered) || mapSizeMoved(shadow, remembered)
  }

  /** Write down what the drawn map depends on, so the next frame compares against it. */
  function rememberLight(light, shadow, remembered) {
    remembered.shadowAtX = light.position.x
    remembered.shadowAtY = light.position.y
    remembered.shadowAtZ = light.position.z
    remembered.shadowWidth = shadow.mapSize.width
    const target = light.target
    if (target) {
      remembered.shadowTargetX = target.position.x
      remembered.shadowTargetY = target.position.y
      remembered.shadowTargetZ = target.position.z
    }
    const view = shadow.camera
    if (view) {
      remembered.shadowLeft = view.left
      remembered.shadowRight = view.right
      remembered.shadowTop = view.top
      remembered.shadowBottom = view.bottom
      remembered.shadowNear = view.near
      remembered.shadowFar = view.far
    }
  }

  function updateShadows() {
    for (const light of state.scene.children) {
      if (!light.isLight || !light.castShadow || !light.shadow) continue
      const shadow = light.shadow
      const remembered = light.userData
      shadow.autoUpdate = false
      if (state.shadowDirty || shadowMoved(light, shadow, remembered)) shadow.needsUpdate = true
      rememberLight(light, shadow, remembered)
    }
    state.shadowDirty = false
  }

  /** A flat background colour, or null to leave the page showing through. */
  function setSky(colour) {
    state.scene.background = colour === null || colour === undefined
      ? null
      : readColour(colour, 'setSky')
  }

  /**
   * Exponential-squared fog, which is the one that reads as air rather than
   * as a wall at a fixed distance. Density 0 turns it off outright — a fog
   * with no density still costs every material a recompile to carry.
   */
  function setFog(density, colour) {
    const amount = Number(density) || 0
    if (amount <= 0) { state.scene.fog = null; return }
    state.scene.fog = new THREE.FogExp2(readColour(colour, 'setFog') || new THREE.Color('#8a94a3'), amount)
  }

  function setAmbient(intensity, colour) {
    const amount = readIntensity(intensity, 'setAmbient')
    if (amount !== null) ambient.intensity = amount
    const c = readColour(colour, 'setAmbient')
    if (c) ambient.color = c
  }

  /** The sun: which way it shines, how hard, and what colour. */
  function setSun(direction, intensity, colour) {
    aimSun(direction)
    const amount = readIntensity(intensity, 'setSun')
    if (amount !== null) sun.intensity = amount
    const c = readColour(colour, 'setSun')
    if (c) sun.color = c
  }

  state.aimSun = aimSun
  state.updateShadows = updateShadows
  state.setSky = setSky
  state.setFog = setFog
  state.setAmbient = setAmbient
  state.setSun = setSun
}
