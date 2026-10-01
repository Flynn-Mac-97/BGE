/** Installable exports cache their own files and change cache identity when content changes. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeWebApp } from '../engine/export-web-app.mjs'

test('opt-in web apps use relative paths and version caches from content', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'bge-web-app-'))
  try {
    const html = '<html><head></head><body>game</body></html>'
    await fs.writeFile(path.join(out, 'index.html'), html)
    await writeWebApp(out, {})
    assert.equal(await fs.readFile(path.join(out, 'index.html'), 'utf8'), html)
    await writeWebApp(out, { title: 'Demo', web: { installable: true } })
    const manifest = JSON.parse(await fs.readFile(path.join(out, 'manifest.webmanifest')))
    assert.equal(manifest.start_url, './')
    assert.equal(manifest.display, 'standalone')
    const first = await fs.readFile(path.join(out, 'sw.js'), 'utf8')
    assert.match(first, /self.registration.scope/)
    assert.match(first, /name.startsWith\(prefix\)/)
    await fs.writeFile(path.join(out, 'index.html'), html.replace('game', 'updated'))
    await writeWebApp(out, { title: 'Demo', web: { installable: true } })
    assert.notEqual(await fs.readFile(path.join(out, 'sw.js'), 'utf8'), first)
    await assert.rejects(writeWebApp(out, { web: { installable: true, icon: 'assets/../../secret.png' } }), /assets directory/)
  } finally { await fs.rm(out, { recursive: true, force: true }) }
})
