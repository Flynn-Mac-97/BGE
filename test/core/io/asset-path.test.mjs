/**
 * Where an asset name points, as a path and as a URL.
 *
 * `asset-path.js` exists because the rule once had five copies and nothing kept
 * them in step, and every way they drifted failed in silence: a texture the
 * renderer could not fetch, or a `check` that reported a whole project's assets
 * missing while the files sat on disk. The six cases its header documents are
 * held here, so the one copy cannot drift from its own description.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PROJECT_PREFIX, assetPath, assetURL } from '../../../engine/asset-path.js'

/** The six folders a project owns. Only these make a reference project-relative. */
const PROJECT_FOLDERS = ['assets', 'levels', 'types', 'behaviours', 'tests', 'plugins']

test('a bare name means assets/', () => {
  assert.equal(assetPath('player.png'), 'assets/player.png')
  assert.equal(assetPath('hit.wav'), 'assets/hit.wav')
})

test('each of the six project folders is taken as given', () => {
  assert.equal(PROJECT_FOLDERS.length, 6)
  for (const folder of PROJECT_FOLDERS) {
    assert.equal(assetPath(`${folder}/thing.ext`), `${folder}/thing.ext`)
  }
})

test('a subfolder that is not a project folder still resolves under assets/', () => {
  assert.equal(assetPath('counter-strike/wall.png'), 'assets/counter-strike/wall.png')
  assert.equal(assetPath('decals/bullet-hole.png'), 'assets/decals/bullet-hole.png')
})

test('a folder name that only starts like a project folder is not one', () => {
  assert.equal(assetPath('assetsy/thing.png'), 'assets/assetsy/thing.png')
  assert.equal(assetPath('plugin/thing.png'), 'assets/plugin/thing.png')
})

test('a leading project/ is stripped, written either way', () => {
  assert.equal(assetPath('project/assets/sky.png'), 'assets/sky.png')
  assert.equal(assetPath('/project/assets/sky.png'), 'assets/sky.png')
  assert.equal(assetPath('project/player.png'), 'assets/player.png')
})

test('the URL is the path under the project prefix the browser fetches', () => {
  for (const reference of ['player.png', 'levels/main.json', 'counter-strike/wall.png']) {
    assert.equal(assetURL(reference), `/${PROJECT_PREFIX}/${assetPath(reference)}`)
  }
})
