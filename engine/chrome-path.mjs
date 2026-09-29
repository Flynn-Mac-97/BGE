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
 *
 * A Playwright browser cache (`PLAYWRIGHT_BROWSERS_PATH`) comes after Chrome for
 * Testing and before an installed Chrome. It is a separate binary too, and a
 * cloud session image ships one, so a lane starts there with nothing set up.
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
    try {
      builds = fs.readdirSync(root).sort().reverse()
    } catch {
      continue
    }
    for (const build of builds) {
      // `chrome-win64`, `chrome-mac-x64`, `chrome-linux64`: the unpacked
      // directory is named for the platform the build was downloaded for, so it
      // is found rather than guessed.
      let unpacked
      try {
        unpacked = fs.readdirSync(path.join(root, build))
      } catch {
        continue
      }
      for (const folder of unpacked) {
        const exe = path.join(root, build, folder, executable)
        if (fs.existsSync(exe)) return exe
      }
    }
  }
  return null
}

/** Where a Playwright Chromium build keeps its executable, by platform. */
const PLAYWRIGHT_EXECUTABLES = {
  win32: ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe'],
  darwin: ['chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'],
  linux: ['chrome-linux64/chrome', 'chrome-linux/chrome']
}

/**
 * The newest Chromium in the Playwright browser cache, or null.
 *
 * Builds are folders named `chromium-<revision>`; the highest revision wins.
 * `chromium_headless_shell-*` and the other browsers do not match, because they
 * cannot open the debugging page a lane needs.
 */
export function playwrightChrome(cache = process.env.PLAYWRIGHT_BROWSERS_PATH) {
  if (!cache) return null
  const executables = PLAYWRIGHT_EXECUTABLES[process.platform] || PLAYWRIGHT_EXECUTABLES.linux
  let builds
  try {
    builds = fs.readdirSync(cache).filter(name => /^chromium-\d+$/.test(name))
  } catch {
    return null
  }
  const revision = name => Number(name.slice('chromium-'.length))
  for (const build of builds.sort((first, second) => revision(second) - revision(first))) {
    for (const executable of executables) {
      const exe = path.join(cache, build, executable)
      if (fs.existsSync(exe)) return exe
    }
  }
  return null
}

/** The first installed Chrome that exists, or null. */
export const installedChrome = () => INSTALLED_CHROME_PLACES.find(place => fs.existsSync(place)) || null

/**
 * The browser to start: CHROME_PATH, else Chrome for Testing, else a Playwright
 * Chromium, else an installed Chrome. Throws naming every place tried when there
 * is none.
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
  const found = named || chromeForTesting(from) || playwrightChrome() || installedChrome()
  if (!found) {
    throw new Error(
      `no Chrome found. Tried .browsers under ${path.resolve(from)} and above it, then:\n  ` +
        INSTALLED_CHROME_PLACES.join('\n  ') +
        '\nand the Playwright cache in PLAYWRIGHT_BROWSERS_PATH' +
        '\nInstall one with: npx @puppeteer/browsers install chrome@stable --path .browsers' +
        '\nOr set CHROME_PATH to point at one.'
    )
  }
  return found
}
