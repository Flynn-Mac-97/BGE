/**
 * Which Chrome the engine starts.
 *
 * No Chrome runs here. Each case builds a fake `.browsers` tree and reads back
 * the path chosen. A fall back to the person's installed Chrome is the failure
 * this guards: that browser hands the page to the tabs they already have open.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { chromeForTesting, findChrome, INSTALLED_CHROME_PLACES } from '../engine/chrome-path.mjs'

/** The executable name Chrome for Testing unpacks to, for this platform. */
const executable = process.platform === 'win32' ? 'chrome.exe'
  : process.platform === 'darwin' ? 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
    : 'chrome'

/** The folder name the download unpacks to, for this platform. */
const unpacked = process.platform === 'win32' ? 'chrome-win64'
  : process.platform === 'darwin' ? 'chrome-mac-x64' : 'chrome-linux64'

/** An empty checkout that is removed when the test ends. */
function checkout(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-chrome-path-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

/** Write a fake Chrome for Testing build under a checkout and return its path. */
function installBuild(root, build) {
  const exe = path.join(root, '.browsers', 'chrome', build, unpacked, executable)
  fs.mkdirSync(path.dirname(exe), { recursive: true })
  fs.writeFileSync(exe, '')
  return exe
}

test('a checkout with no .browsers has no Chrome for Testing', t => {
  assert.equal(chromeForTesting(checkout(t)), null)
})

test('Chrome for Testing is found in the checkout', t => {
  const root = checkout(t)
  const exe = installBuild(root, 'win64-120.0.0.0')
  assert.equal(chromeForTesting(root), exe)
})

test('the newest build wins', t => {
  const root = checkout(t)
  installBuild(root, 'win64-120.0.0.0')
  const newer = installBuild(root, 'win64-153.0.8010.52')
  assert.equal(chromeForTesting(root), newer)
})

test('a worktree inside the checkout uses the checkout\'s browser', t => {
  const root = checkout(t)
  const exe = installBuild(root, 'win64-153.0.8010.52')
  // `.browsers` is not committed, so a lane's worktree never holds one.
  const worktree = path.join(root, '.agent-worktrees', 'lane-alpha', 'deeper')
  fs.mkdirSync(worktree, { recursive: true })
  assert.equal(chromeForTesting(worktree), exe)
})

/** Set CHROME_PATH for one test and put back whatever was there. */
function withChromePath(t, value) {
  const had = process.env.CHROME_PATH
  if (value === undefined) delete process.env.CHROME_PATH
  else process.env.CHROME_PATH = value
  t.after(() => { if (had === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = had })
}

test('CHROME_PATH wins over Chrome for Testing', t => {
  const root = checkout(t)
  installBuild(root, 'win64-153.0.8010.52')
  const named = path.join(root, 'named-by-the-caller')
  fs.writeFileSync(named, '')
  withChromePath(t, named)
  assert.equal(findChrome(root), named)
})

test('Chrome for Testing is preferred over an installed Chrome', t => {
  const root = checkout(t)
  const exe = installBuild(root, 'win64-153.0.8010.52')
  withChromePath(t, undefined)
  assert.equal(findChrome(root), exe)
  assert.ok(!INSTALLED_CHROME_PLACES.includes(findChrome(root)))
})

test('a CHROME_PATH that does not exist is named, not spawned', t => {
  const root = checkout(t)
  installBuild(root, 'win64-153.0.8010.52')
  withChromePath(t, path.join(root, 'no-such-chrome'))
  assert.throws(() => findChrome(root), /CHROME_PATH names .*no-such-chrome, which does not exist/)
})

test('a bare CHROME_PATH name is left to the spawn to resolve', t => {
  const root = checkout(t)
  withChromePath(t, 'chromium')
  assert.equal(findChrome(root), 'chromium')
})
