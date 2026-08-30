/**
 * The ray battery: what sits at a screen point, over a grid, and from an
 * entity — proved headless, on the meadow's own misplaced floor.
 *
 * The meadow's floor collider sits six metres below the y = 0 plane its
 * `about` text claims — the level's own authored mismatch, and the clearest
 * real case for "what is under this thing, and how far". A downward ray
 * from the kitten's edited placement, before anything falls, measures it.
 */
const PLAY_VIEW = 'meadow-play'

export default {
  name: 'the ray battery — a screen point, a grid, and a straight line',
  level: 'meadow',

  async run(test) {
    // ---- from an entity, headless-safe, no camera involved
    const down = await test.run('see.ray', { from: 'you', direction: 'down' })
    test.is(down.hits.length, 1, 'nothing sits between the kitten and the floor')
    test.is(down.hits[0].id, 'floor', 'the floor is what a downward ray from the kitten finds')
    test.near(down.hits[0].distance, 6, 0.1,
      `the misplaced floor sits about six metres below the kitten's placement — got ${down.hits[0].distance}`)
    test.ok(!!down.hits[0].about, 'the hit carries what the author wrote the floor to be')
    test.ok(typeof down.limits === 'string' && /BOXES/.test(down.limits),
      'the reply states the box-versus-silhouette limit rather than hiding it')

    // A level light is an entity too, and boundsOf gives an undeclared box a
    // default 1x1x1 — so "nothing physically in the way" reads as either no
    // hit, or only a light, far off. That default box is a known limit, not
    // a ray bug: describe() and occlusion() box every entity the same way.
    const up = await test.run('see.ray', { from: 'you', direction: 'up' })
    test.ok(up.hits.every(hit => hit.type === 'light'),
      `nothing but a light sits above the kitten in open sky — got ${JSON.stringify(up.hits)}`)

    // ---- refusals name the problem, never a null or an empty hit list
    const badDirection = await test.run('see.ray', { from: 'you', direction: 'sideways' })
    test.ok(/unknown direction/.test(badDirection.error || ''), `an unknown direction is refused — "${badDirection.error}"`)

    const noEntity = await test.run('see.ray', { from: 'not-a-thing', direction: 'down' })
    test.ok(/no entity/.test(noEntity.error || ''), `a missing "from" entity is named — "${noEntity.error}"`)

    const badAt = await test.run('see.ray', { at: [50] })
    test.ok(/at needs two numbers/.test(badAt.error || ''), `a malformed "at" is refused — "${badAt.error}"`)

    const badGrid = await test.run('see.ray', { grid: [0, 4] })
    test.ok(/grid needs two positive numbers/.test(badGrid.error || ''), `a malformed "grid" is refused — "${badGrid.error}"`)

    const noArgs = await test.run('see.ray', {})
    test.ok(/needs one of/.test(noArgs.error || ''), `no arguments names the three forms it takes — "${noArgs.error}"`)

    // ---- a screen point and a grid, through the saved play camera so the
    // shot is reproducible run to run
    await test.run('see.view', { go: PLAY_VIEW })

    const centre = await test.run('see.ray', { at: [50, 50] })
    test.ok(Array.isArray(centre.hits) && centre.hits.length > 0, 'a ray down the middle of the meadow hits something')
    test.ok(centre.hits.every(hit => Number.isFinite(hit.distance) || hit.note),
      'every hit carries a distance, or says why it has none')
    test.ok(centre.hits.every((hit, index) => index === 0 || hit.distance >= centre.hits[index - 1].distance),
      'hits come back nearest first')
    test.ok(/box rays/.test(centre.method), `the reply names its method — "${centre.method}"`)
    test.ok(Number.isFinite(centre.origin.x) && Number.isFinite(centre.direction.x),
      'the reply carries the world-space origin and direction the screen point resolved to')

    const grid = await test.run('see.ray', { grid: [6, 4] })
    test.is(grid.rays, 24, 'grid reports the ray count it actually cast')
    test.ok(grid.results.every(cell => cell.hits.length > 0), 'a reported cell always carries at least one hit')
    test.ok(grid.results.some(cell => cell.hits.some(hit => hit.type === 'ground')),
      'the floor turns up somewhere in a downward-looking grid over the meadow')
    // Forty rays instead of nine hundred entities: the grid reply names far
    // fewer things than the level holds, whatever the level's own crowd size.
    test.ok(grid.results.length * 10 < test.entities.length,
      `the grid answers an order of magnitude fewer entries than the level holds entities — `
      + `${grid.results.length} cells against ${test.entities.length} entities`)

    if (typeof document === 'undefined') {
      test.note('the id-buffer pixel seed only runs with a renderer attached — open the editor to exercise it')
    }
  }
}
