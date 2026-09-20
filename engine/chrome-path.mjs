/**
 * Which Chrome the engine starts.
 *
 * Chrome for Testing under `.browsers` is preferred over an installed Chrome,
 * and every spawn site in the engine resolves through here so one rule decides.
 *
 * An installed Chrome that cannot start a process of its own hands the URL to
 * the Chrome the person already has open. The page then becomes one of their
 * tabs, the debugging port never answers, and nothing the caller kills can
 * reach it. A separate binary cannot join their browser.
 *
 * `npx @puppeteer/browsers install chrome@stable --path .browsers` puts one
 * there. CHROME_PATH names a browser instead and wins over both.
 */
import fs from 'node:fs'
import path from 'node:path'

/** Installed Chrome, in the order worth trying. */
export const INSTALLED_CHROME_PLACES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
]

/** The executable inside one unpacked Chrome for Testing build, by platform. */
const TESTING_EXECUTABLES = {
  win32: 'chrome.exe',
  darwin: 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  linux: 'chrome'
}

/** Every directory from `start` up to the filesystem root. */
function* upwards(start) {
  for (let directory = path.resolve(start); ; directory = path.dirname(directory)) {
    yield directory
    if (path.dirname(directory) === directory) return
  }
}

/**
 * Chrome for Testing under `.browsers`, or null.
 *
 * `.browsers` is not committed, so a lane's git worktree never holds one. The
 * search walks up from the given directory to the checkout that does, so a lane
 * uses the same browser as the main checkout.
 *
 * The newest build wins: builds sort by version and the last is taken.
 */
export function chromeForTesting(from = process.cwd()) {
  const executable = TESTING_EXECUTABLES[process.platform] || TESTING_EXECUTABLES.linux
  for (const directory of upwards(from)) {
    const root = path.join(directory, '.browsers', 'chrome')
    let builds
    try { builds = fs.readdirSync(root).sort().reverse() } catch { continue }
    for (const build of builds) {
      // `chrome-win64`, `chrome-mac-x64`, `chrome-linux64`: the unpacked
      // directory is named for the platform the build was downloaded for, so it
      // is found rather than guessed.
      let unpacked
      try { unpacked = fs.readdirSync(path.join(root, build)) } catch { continue }
      for (const folder of unpacked) {
        const exe = path.join(root, build, folder, executable)
        if (fs.existsSync(exe)) return exe
      }
    }
  }
  return null
}

/** The first installed Chrome that exists, or null. */
export const installedChrome = () => INSTALLED_CHROME_PLACES.find(place => fs.existsSync(place)) || null

/**
 * The browser to start: CHROME_PATH, else Chrome for Testing, else an installed
 * Chrome. Throws naming every place tried when there is none.
 *
 * `from` is the directory the `.browsers` search starts at — a lane's worktree
 * is fine, because the search walks up to the checkout that holds one.
 */
export function findChrome(from = process.cwd()) {
  const named = process.env.CHROME_PATH
  // A bare name is left to the spawn, which resolves it on PATH. A path with a
  // separator is checked here, so a typo is named rather than failing later as
  // a spawn error with no cause.
  if (named && /[\\/]/.test(named) && !fs.existsSync(named)) {
    throw new Error(`CHROME_PATH names ${named}, which does not exist`)
  }
  const found = named || chromeForTesting(from) || installedChrome()
  if (!found) {
    throw new Error(
      `no Chrome found. Tried .browsers under ${path.resolve(from)} and above it, then:\n  `
      + INSTALLED_CHROME_PLACES.join('\n  ')
      + '\nInstall one with: npx @puppeteer/browsers install chrome@stable --path .browsers'
      + '\nOr set CHROME_PATH to point at one.')
  }
  return found
}
