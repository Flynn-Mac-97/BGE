/**
 * Opening a page in the engine's own browser.
 *
 * No browser runs here. The arguments and the profile path are read back, and
 * the one start that happens runs node, which exits on the browser arguments at
 * once. The point guarded is that the engine never uses the system opener: that
 * gives the page to the browser the person already has open.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { openPage, openPageArguments, profileDirectory } from '../engine/open-page.mjs'

/** An empty checkout that is removed when the test ends. */
function checkout(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-open-page-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

/** Set CHROME_PATH for one test and put back whatever was there. */
function withChromePath(t, value) {
  const had = process.env.CHROME_PATH
  if (value === undefined) delete process.env.CHROME_PATH
  else process.env.CHROME_PATH = value
  t.after(() => { if (had === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = had })
}

test('the profile is kept beside the browser, under its name', t => {
  const root = checkout(t)
  assert.equal(profileDirectory(root, 'editor'), path.join(root, '.browsers', 'profiles', 'editor'))
  // Two names are two windows with two profiles, not one shared one.
  assert.notEqual(profileDirectory(root, 'editor'), profileDirectory(root, 'inspect'))
})

test('the window is visible: nothing asks for headless', t => {
  const said = openPageArguments({ profile: 'P', url: 'http://localhost:5180/' })
  assert.ok(!said.some(argument => argument.includes('headless')))
  assert.ok(said.includes('--new-window'))
  assert.equal(said.at(-1), 'http://localhost:5180/')
})

test('a profile of its own keeps the window out of the person\'s browser', t => {
  const said = openPageArguments({ profile: 'C:/checkout/.browsers/profiles/editor', url: 'http://x/' })
  assert.ok(said.includes('--user-data-dir=C:/checkout/.browsers/profiles/editor'))
})

test('a size is asked for only when one is given', t => {
  assert.ok(!openPageArguments({ profile: 'P', url: 'http://x/' }).some(a => a.startsWith('--window-size')))
  assert.ok(openPageArguments({ profile: 'P', url: 'http://x/', width: 1280, height: 800 })
    .includes('--window-size=1280,800'))
})

test('no browser to open is reported, not thrown', t => {
  const root = checkout(t)
  withChromePath(t, path.join(root, 'no-such-chrome'))
  const opened = openPage('http://localhost:5180/', { checkout: root })
  assert.equal(opened.opened, false)
  assert.match(opened.problem, /no-such-chrome/)
})

test('a started window reports which browser it used, and makes its profile', t => {
  const root = checkout(t)
  // node, not chrome: it rejects the browser arguments and exits at once.
  withChromePath(t, process.execPath)
  const opened = openPage('http://localhost:5180/', { checkout: root, profile: 'editor' })
  assert.equal(opened.opened, true)
  assert.equal(opened.chrome, process.execPath)
  assert.equal(opened.profile, profileDirectory(root, 'editor'))
  assert.ok(fs.existsSync(opened.profile))
})
