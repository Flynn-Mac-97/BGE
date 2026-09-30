/**
 * Android export: the application id, the manifest, and one real APK build
 * (skipped where no Android SDK is installed).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { exportAndroid, manifestText, packageName } from '../engine/export-android.mjs'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('the application id is the game.json package, else a safe name from the folder', () => {
  assert.equal(packageName({ android: { package: 'com.me.game' } }, '/x/y'), 'com.me.game')
  assert.equal(packageName({}, '/games/My Game-2'), 'com.engine.mygame2')
  assert.equal(packageName({}, '/games/3d'), 'com.engine.game3d')
})

test('the manifest carries the title escaped and the orientation, and refuses an unknown one', () => {
  const text = manifestText({ id: 'com.engine.tiny', title: 'A "B" <C>', orientation: 'landscape' })
  assert.match(text, /android:label="A &quot;B&quot; &lt;C>"/)
  assert.match(text, /sensorLandscape/)
  assert.throws(() => manifestText({ id: 'a.b', title: 't', orientation: 'sideways' }), /not landscape/)
})

const hasSdk = ['ANDROID_HOME', 'ANDROID_SDK_ROOT'].some(name => process.env[name]) || (await fs.stat('/usr/local/lib/android/sdk').catch(() => null))
let hasJdk = true
try {
  execFileSync('javac', ['-version'], { stdio: 'ignore' })
} catch {
  hasJdk = false
}

test('an export builds a signed APK holding the game', { timeout: 240000, skip: !(hasSdk && hasJdk) }, async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-apk-'))
  const project = path.join(scratch, 'tiny')
  await fs.mkdir(path.join(project, 'levels'), { recursive: true })
  await fs.writeFile(path.join(project, 'game.json'), JSON.stringify({ title: 'Tiny', startLevel: 'main', plugins: { only: ['Render'] } }))
  await fs.writeFile(path.join(project, 'levels/main.json'), JSON.stringify({ entities: [] }))
  try {
    const result = await exportAndroid({ checkout: CHECKOUT, project, out: path.join(scratch, 'tiny.apk') })
    assert.equal(result.id, 'com.engine.tiny')
    const stat = await fs.stat(result.apk)
    assert.ok(stat.size > 1000)
    const listing = execFileSync('unzip', ['-l', result.apk], { encoding: 'utf8' })
    assert.match(listing, /assets\/www\/index\.html/)
    assert.match(listing, /classes\.dex/)
  } finally {
    await fs.rm(scratch, { recursive: true, force: true })
  }
})
