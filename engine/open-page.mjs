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
 *
 * A visible window is recorded in the same registry as a lane, with
 * `headless: false`, so one reader finds and one stop closes every browser this
 * engine started.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { findChrome } from './chrome-path.mjs'
import {
  activatePage,
  findFreeDebuggingPort,
  openTabOnPort,
  pagesOnPort,
  readLaneBrowsers,
  recordLaneBrowser
} from './lane-browsers.mjs'

/**
 * Where a visible browser keeps its profile.
 *
 * Beside the browser, not in `agent-runs`, which `agent.sweep` clears. The
 * profile holds window size and zoom, so a person gets the window back the way
 * they left it. Its tabs are removed before every fresh start.
 */
export const profileDirectory = (checkout, name) => path.join(checkout, '.browsers', 'profiles', name)

/**
 * The session files Chrome restores at startup.
 *
 * A visible profile is kept so window size and zoom return. The tabs must not:
 * Chrome's "continue where you left off" brings every old editor back, and each
 * one is a second engine with its own world. A fresh start removes the record
 * of the last session, so only the page asked for opens.
 */
const SESSION_FILES = ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs']

/** Remove the profile's saved session, so a fresh browser restores no old tabs. */
export function clearSessionState(profile) {
  const chromium = path.join(profile, 'Default')
  // A browser still holding the profile locks these, and Windows answers EPERM.
  // Tidying the last session must never stop this one from opening.
  for (const name of SESSION_FILES) {
    try {
      fs.rmSync(path.join(chromium, name), { force: true })
    } catch {
      /* held by a live browser */
    }
  }
  try {
    fs.rmSync(path.join(chromium, 'Sessions'), { recursive: true, force: true })
  } catch {
    /* held */
  }
  markProfileExitedCleanly(chromium)
}

/**
 * Tell the profile its last run ended cleanly.
 *
 * The engine kills a browser outright, which leaves `exit_type: "Crashed"`.
 * Chrome then starts in crash recovery and, with the restore bubble suppressed,
 * opens no window at all while still serving the page over its debugging port —
 * so every check passes and the screen stays empty.
 */
export function markProfileExitedCleanly(chromium) {
  const file = path.join(chromium, 'Preferences')
  let preferences
  try {
    preferences = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return false
  }
  preferences.profile = { ...preferences.profile, exit_type: 'Normal', exited_cleanly: true }
  try {
    fs.writeFileSync(file, JSON.stringify(preferences))
    return true
  } catch {
    return false
  }
}

/** One URL shape, so a trailing slash is not a different page. */
function normalizedUrl(value) {
  try {
    return new URL(value).href
  } catch {
    return String(value)
  }
}

/** The page already on this url, or null. */
export function pageOnUrl(pages, url) {
  const wanted = normalizedUrl(url)
  return pages.find(page => normalizedUrl(page.url) === wanted) || null
}

// A browser answers its debugging port before the page it was given has
// settled: the target may be missing, or still `about:blank`. One read would
// call that browser empty and open a second page in it, so the url is asked
// for until it appears.
const FRESH_PAGE_MILLISECONDS = 30_000
// A running browser unasked for a page settles in a moment. The shorter cap
// keeps a browser that genuinely holds no window from delaying the new one.
const REUSE_PAGE_MILLISECONDS = 5_000

/** A page that is not yet at a url: absent, or Chrome's startup blank. */
const blankPage = page => {
  const url = String(page?.url || '')
  return url === '' || url === 'about:blank'
}

/** Whether every page on the port is a placeholder, not a url the caller asked for. */
const stillStarting = pages => pages.length === 0 || pages.every(blankPage)

/** Whether a pid still exists. */
function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * The page on this url once the browser has settled, or null at the deadline.
 *
 * `alive` stops the wait when the process behind the port is gone, so a browser
 * that died on start is reported rather than waited on for the full interval.
 */
async function waitForPage(port, url, { milliseconds = FRESH_PAGE_MILLISECONDS, alive } = {}) {
  const deadline = Date.now() + milliseconds
  for (;;) {
    const pages = await pagesOnPort(port)
    const page = pages && pageOnUrl(pages, url)
    if (page) return page
    if (alive && !alive()) return null
    if (Date.now() >= deadline) return null
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

/** What Chrome is told to open. Separate from the spawn so a test can read it. */
export const openPageArguments = ({ profile, url, width, height, port }) => [
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  // The window shows the engine and nothing else. The crash bubbles are off
  // because the profile is kept and the engine's browser is killed outright
  // when a server stops, which Chrome reports as a crash on the next open.
  '--no-service-autorun',
  '--disable-features=Translate,MediaRouter',
  '--disable-session-crashed-bubble',
  '--hide-crash-restore-bubble',
  // A window behind another one, and a tab that is not the front tab, are
  // marked hidden by Chrome: the page stops drawing and stops answering the
  // bridge. Several engines as tabs, and one window behind a terminal, are both
  // normal here, so the backgrounding that causes it is turned off.
  '--disable-backgrounding-occluded-windows',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  // A debugging port makes the window findable and stoppable, the same as a
  // lane. Left out when no port could be had, so the window still opens.
  ...(port ? [`--remote-debugging-port=${port}`] : []),
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
 * worktree is fine. A profile with no live browser is started and recorded
 * under the profile name, with its debugging port, so it can be listed and
 * stopped like a lane. A profile that already has a live browser is reused: a
 * page already on this url is brought to the front and returned, and only a url
 * the browser does not have open adds a window. A second launch with a new
 * debugging port would be ignored, so its record and port are kept and the
 * reply says `reused: true` rather than naming a port nobody answers.
 *
 * A port that cannot be found and a record that cannot be written each become a
 * `problem` on a successful open: a page that will not record must not stop a
 * server serving it. Returns what it started, with `port` and `reused`.
 */
export async function openPage(url, { checkout = process.cwd(), profile: name = 'editor', width, height } = {}) {
  let chrome
  try {
    chrome = findChrome(checkout)
  } catch (error) {
    return { opened: false, problem: error.message }
  }

  const profile = profileDirectory(checkout, name)

  // A profile already held by a live browser is reused. A page already on this
  // url is brought to the front; a page elsewhere in the same browser means a
  // window is added. A browser whose page has not settled is waited on, not
  // read as empty: that read is what left a second page in one editor window. A
  // second launch with `--remote-debugging-port` is ignored, so recording the
  // new launcher's pid and port would name a process that has exited and a port
  // nobody answers.
  const existing = readLaneBrowsers(checkout).find(entry => entry.client === name)
  if (existing) {
    const pages = await pagesOnPort(existing.port)
    if (pages) {
      const open =
        pageOnUrl(pages, url) ||
        (stillStarting(pages) ? await waitForPage(existing.port, url, { milliseconds: REUSE_PAGE_MILLISECONDS }) : null)
      if (open) {
        await activatePage(existing.port, open.id)
        return {
          opened: true,
          reused: true,
          activated: true,
          chrome,
          profile,
          url,
          pid: existing.pid,
          port: existing.port,
          pageId: open.id
        }
      }
      // The running browser is asked for the tab, rather than Chrome being
      // launched again: a second launch is handed to this browser, which chooses
      // window or tab itself and reports no page id, so the page cannot
      // afterwards be counted or closed.
      const pageId = await openTabOnPort(existing.port, url)
      if (pageId) {
        return {
          opened: true,
          reused: true,
          activated: true,
          chrome,
          profile,
          url,
          pid: existing.pid,
          port: existing.port,
          pageId
        }
      }
      return {
        opened: false,
        problem:
          `the browser on port ${existing.port} would not open ${url} as a tab; stop it with ` +
          `\`node bin/engine.mjs lanes.stop ${name}\` and open again`
      }
    }
  }

  let port = null
  let problem = null
  try {
    port = await findFreeDebuggingPort(checkout)
  } catch (error) {
    problem = error.message
  }

  try {
    fs.mkdirSync(profile, { recursive: true })
    // A kept profile restores its last tabs, and each restored tab is another
    // engine. Remove the session before a fresh browser reads it.
    clearSessionState(profile)
    // Detached with no pipes: the window outlives the command that opened it.
    // `windowsHide` must be false here, and only here. Windows passes the flag
    // to the child as STARTUPINFO's SW_HIDE, and Chrome obeys it for its own
    // window: the browser comes up, answers its debugging port and renders,
    // with nothing on screen. This is the one visible window the engine opens,
    // so it is the one spawn that must not hide.
    const browser = spawn(chrome, openPageArguments({ profile, url, width, height, port }), {
      stdio: 'ignore',
      detached: true,
      windowsHide: false
    })
    browser.unref()
    const opened = {
      opened: true,
      reused: false,
      activated: false,
      chrome,
      profile,
      url,
      pid: browser.pid,
      port,
      pageId: null
    }
    // No port means no way to prove the window later, so nothing is recorded.
    if (port === null) return { ...opened, problem }
    try {
      recordLaneBrowser(checkout, {
        client: name,
        port,
        url,
        pid: browser.pid,
        profile,
        serves: checkout,
        chrome,
        headless: false,
        startedBrowser: true,
        startedAt: new Date().toISOString()
      })
    } catch (error) {
      opened.problem = `the window opened but could not be recorded: ${error.message}`
    }
    // Return only once the page asked for is up, so the record names a settled
    // open: the next caller reads a page rather than an empty browser and adds
    // no second window. A page that never appears is a problem, not a failed
    // open, because the browser itself is running.
    const page = await waitForPage(port, url, { alive: () => processAlive(browser.pid) })
    if (page) opened.pageId = page.id
    else opened.problem = opened.problem ?? 'the browser opened but its page did not appear'
    return opened
  } catch (error) {
    return { opened: false, problem: `could not start ${chrome}: ${error.message}` }
  }
}
