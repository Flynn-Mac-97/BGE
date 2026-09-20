/**
 * Open a page in the engine's own browser, with a window a person can see.
 *
 * The engine never hands a URL to the browser the person already has open. The
 * system opener and Vite's `open` both do: the page becomes one of their tabs,
 * mixed in with their own work, sharing their extensions and their signed-in
 * profile. Chrome for Testing under `.browsers` is a separate binary with its
 * own profile, so the engine's windows are its own.
 *
 * Headless lanes use `startLaneBrowser`. This is the visible half, and the only
 * one a person looks at.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { findChrome } from './chrome-path.mjs'

/**
 * Where a visible browser keeps its profile.
 *
 * Beside the browser, not in `agent-runs`, which `agent.sweep` clears. The
 * profile holds window size, zoom and open tabs, so a person gets the window
 * back as they left it.
 */
export const profileDirectory = (checkout, name) =>
  path.join(checkout, '.browsers', 'profiles', name)

/** What Chrome is told to open. Separate from the spawn so a test can read it. */
export const openPageArguments = ({ profile, url, width, height }) => [
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  // The window shows the engine and nothing else. The crash bubbles are off
  // because the profile is kept and the engine's browser is killed outright
  // when a server stops, which Chrome reports as a crash on the next open.
  '--no-service-autorun', '--disable-features=Translate,MediaRouter',
  '--disable-session-crashed-bubble', '--hide-crash-restore-bubble',
  ...(width && height ? [`--window-size=${width},${height}`] : []),
  // A second open with this profile reaches the running browser and opens a
  // window there rather than starting a browser that cannot have one.
  '--new-window',
  url
]

/**
 * Open a URL in a visible Chrome for Testing window.
 *
 * `checkout` is where the `.browsers` search starts; it walks up, so a lane's
 * worktree is fine. Returns what it started, or a `problem` naming why it could
 * not — a page that will not open must not stop a server serving it.
 */
export function openPage(url, { checkout = process.cwd(), profile: name = 'editor', width, height } = {}) {
  let chrome
  try { chrome = findChrome(checkout) } catch (error) { return { opened: false, problem: error.message } }

  const profile = profileDirectory(checkout, name)
  try {
    fs.mkdirSync(profile, { recursive: true })
    // Detached with no pipes: the window outlives the command that opened it.
    const browser = spawn(chrome, openPageArguments({ profile, url, width, height }),
      { stdio: 'ignore', detached: true })
    browser.unref()
    return { opened: true, chrome, profile, url, pid: browser.pid }
  } catch (error) {
    return { opened: false, problem: `could not start ${chrome}: ${error.message}` }
  }
}
