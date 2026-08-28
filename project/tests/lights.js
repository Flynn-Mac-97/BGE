/**
 * Lights: placing one, destroying one, a flash that fades and removes itself,
 * and the shadow cap saying so out loud.
 *
 * Every check here runs with nothing drawing, which is where tests run and where
 * a fan-out of agents works. That is the point rather than a limitation: the
 * plugin does its bookkeeping the same either side of a screen and only attaches
 * a three.js object when there is a scene, so a headless run knows exactly the
 * same set of lights a browser does.
 *
 * A test is handed `test` and never a context, so the live plugin is reached the
 * way the camera test reaches its own — by importing the module, which is a
 * singleton in node and in the browser alike.
 */
import {
  runningLights, flashIntensity, resolveLightmaps, readLight, SHADOW_CAP, KINDS
} from '../../plugins/builtin/lights.js'

export default {
  name: 'a light is an entity, a flash fades and removes itself, and the shadow cap warns by name',
  level: 'level1',

  run(test) {
    const live = runningLights()
    test.ok(live, 'the Lights plugin has loaded and put itself where a test can reach it')
    if (!live) return

    const context = live.context
    const lights = context.lights
    test.ok(lights, 'and it contributed context.lights')
    if (!lights) return

    if (!context.renderer) {
      test.note('nothing is drawing, so no three.js light is attached — the registry is the same either way')
    }

    // ------------------------------------------------------- the curve itself
    // Pure, so it can be checked without spawning anything at all.
    test.is(flashIntensity(4, 0, 0.5), 4, 'a flash starts at the intensity it was given')
    test.near(flashIntensity(4, 0.25, 0.5), 1, 1e-9, 'and is a quarter as bright half way through')
    test.is(flashIntensity(4, 0.5, 0.5), 0, 'at its stated duration it is nothing')
    test.is(flashIntensity(4, 9, 0.5), 0, 'and past it, still nothing — never negative')

    // --------------------------------------------- placing and destroying one
    const before = lights.list().length
    const lamp = test.spawn('light', {
      at: [3, 2, -1],
      properties: { kind: 'spot', intensity: 3, range: 8, angle: 30 }
    })
    test.simulate(1 / 60)

    const placed = lights.list().find(light => light.id === lamp.id)
    test.is(lights.list().length, before + 1, 'placing a light entity registered a light')
    test.is(placed?.kind, 'spot', 'of the kind the placement asked for')
    test.near(placed?.range ?? -1, 8, 1e-9, 'with the range it was given')
    test.is(placed?.color, '#ffffff', 'and the type default for everything it did not say')

    test.destroy(lamp.id)
    test.simulate(1 / 60)
    test.is(lights.list().length, before, 'destroying the entity took the light with it')

    // An unknown kind must not go dark in silence.
    const odd = test.spawn('light', { at: [0, 1, 0], properties: { kind: 'lantern' } })
    test.simulate(1 / 60)
    test.is(lights.list().find(light => light.id === odd.id)?.kind, 'point',
      'a kind nobody recognises falls back to a point light')
    test.ok([...live.said].some(message => message.startsWith('[Lights]') && message.includes('lantern')),
      'and says so by name rather than lighting nothing quietly')
    test.destroy(odd.id)

    // ------------------------------------------------- a flash fades and goes
    const flash = lights.flash({ at: { x: 0, y: 2, z: 0 }, color: '#ffd9a0', intensity: 6, seconds: 0.5 })
    test.is(flash.type, 'light', 'a flash is an ordinary light entity, not a private thing')
    test.near(flash.properties.intensity, 6, 1e-9, 'starting at the intensity it was asked for')

    test.simulate(0.25)
    test.ok(test.exists(flash.id), 'half way through its life it is still there')
    test.near(flash.properties.intensity, 1.5, 1e-6, 'a quarter as bright, on the entity where anything can read it')

    test.simulate(0.3)
    test.ok(!test.exists(flash.id), 'past its stated duration it has removed itself')
    test.is(lights.list().some(light => light.id === flash.id), false, 'and the light went with the entity')

    // -------------------------------------------------------- two equal runs
    /**
     * One flash, from a known clock, sampled at a known moment.
     *
     * The clock and the random stream are put back together — resetting only one
     * of them is the subtle version of the bug determinism exists to prevent.
     */
    const sample = seed => {
      for (const light of lights.list()) test.destroy(light.id)
      context.loop.reset(seed)
      const spark = lights.flash({ at: [0, 2, 0], intensity: 6, seconds: 0.5 })
      test.simulate(0.25)
      const intensity = spark.properties.intensity
      test.destroy(spark.id)
      return intensity
    }
    const firstRun = sample(11)
    const secondRun = sample(11)
    test.is(firstRun, secondRun, 'the same seed at the same time gives the same intensity, exactly')
    test.near(firstRun, 1.5, 1e-6, 'and it is the value the curve says, not zero by accident')

    // -------------------------------------------------------- the shadow cap
    const asked = []
    for (let n = 0; n < SHADOW_CAP + 2; n++) {
      asked.push(test.spawn('light', { at: [n * 2, 2, 6], properties: { shadow: true } }))
    }
    test.simulate(1 / 60)

    const casting = lights.list().filter(light => light.castsShadow)
    test.is(casting.length, SHADOW_CAP,
      `${asked.length} lights asked for a shadow and ${SHADOW_CAP} was granted`)
    test.is(casting[0]?.id, asked[0].id, 'the first one placed keeps it')

    const warning = [...live.said].filter(message => message.includes('ask for shadows')).pop()
    test.ok(warning?.startsWith('[Lights]'), 'going over the cap reports itself by name on the console')
    test.ok(warning?.includes(asked[asked.length - 1].id), 'naming the lights that will not be casting one')

    for (const light of asked) test.destroy(light.id)
    test.simulate(1 / 60)
    test.is(lights.list().length, before, 'and everything this test placed has been cleaned up')

    // ----------------------------------------------------- the baked half
    test.is(resolveLightmaps(null).maps, {}, 'a level with no lightmaps block resolves to nothing to do')
    const resolved = resolveLightmaps({
      intensity: 0.8,
      directory: 'counter-strike/maps/',
      maps: { 'brush-3': 'brush-3-lightmap.png', 'brush-4': 7 }
    })
    test.is(resolved.maps['brush-3'], 'counter-strike/maps/brush-3-lightmap.png',
      'a lightmap file is resolved against the block directory')
    test.is(resolved.maps['brush-4'], undefined, 'and anything that is not a file name is dropped')
    test.near(resolved.intensity, 0.8, 1e-9, 'the level intensity comes through')

    // The manifest an offline baker works from. Its own mesh is set on the
    // placement, so this checks the manifest rather than whatever brush.js
    // happens to declare today.
    const wall = test.spawn('brush', { at: [60, 1.5, 60], mesh: { box: [2, 3, 0.4], texture: 'wall.png' } })
    const summary = lights.bake()
    test.is(summary.unit, 'metre', 'the manifest states its units, because a baker cannot guess them')
    test.ok(summary.counts.staticSurfaces >= 1, 'and counts the static surfaces it would bake')
    test.is(summary.surfaces, undefined, 'a long list is not printed unless it is asked for')

    const full = lights.bake({ surfaces: true })
    const surface = full.surfaces.find(item => item.id === wall.id)
    test.ok(surface, 'asked by name, every surface is listed')
    test.is(surface?.size, [2, 3, 0.4], 'with the size the placement really has, in metres')
    test.is(surface?.at, [60, 1.5, 60], 'and where it stands in the world')
    test.is(full.surfaces.some(item => item.type === 'light'), false,
      'a light is not a surface, so it is never in the list of things to bake')
    test.destroy(wall.id)

    // ------------------------------------------------------------ the report
    const report = lights.report()
    test.is(report.shadowCap, SHADOW_CAP, 'the report says what the cap is, so nobody has to read this file')
    test.is(report.drawing, !!context.renderer, 'and whether anything is drawing, which is the commonest reason to see no light')

    // Reading a placement is pure, so the last check needs no world at all.
    const read = readLight({ id: 'x', x: 1, y: 2, z: 3, properties: { kind: 'hemisphere', intensity: 'bright' } })
    test.is(read.kind, 'hemisphere', 'every kind this engine names is readable')
    test.is(read.intensity, 2, 'an intensity that is not a number falls back rather than becoming NaN')
    test.is(KINDS.length, 5, 'point, spot, directional, area and hemisphere')
  }
}
