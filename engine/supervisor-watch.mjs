/**
 * The supervisor as a live table on a terminal.
 *
 * `supervisor --watch` and `engine.cmd` both call `watchSupervisor`. The table
 * is the same for an agent and a person: kind, id, port, pid, project, age, the
 * state the prover last proved, and whether the page can be seen. Under it sits the event feed the supervisor
 * keeps, so a start, a stop or a death found by the prover is not silent. Keys
 * open a dev server, open a visible or headless engine on one, stop one, stop
 * all and quit. Nothing here is a dependency: `readline` and raw mode are built in.
 *
 * A stream that is not a terminal — an agent capturing stdout — gets the table
 * once and no keys, so the same command is readable from a pipe.
 */
import readline from 'node:readline'
import { askSupervisor } from './supervisor.mjs'

const REFRESH_MILLISECONDS = 1_500
// A dev server binds only after Vite has read the checkout and optimised its
// dependencies, which can be minutes on a cold start. Opening waits for that;
// a listing and a stop are quick.
const OPEN_TIMEOUT_MILLISECONDS = 180_000
const LIST_TIMEOUT_MILLISECONDS = 15_000
const STOP_TIMEOUT_MILLISECONDS = 30_000

/** A short age, so a long-running instance does not widen the table. */
export function formatAge(startedAt, now = Date.now()) {
  const started = Date.parse(startedAt)
  if (!Number.isFinite(started)) return '-'
  const seconds = Math.max(0, Math.round((now - started) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
}

/** Cut a value to its column, marking that it was cut. */
const clip = (text, width) => (text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + '…')

/**
 * The fields every row carries, in display order, with the room each needs.
 *
 * `minimum` is where shortening stops; `drop` is when it is removed instead.
 * The columns that carry identity — kind, id, port — stay longest, and project
 * goes first, because it is the field a reader can most often guess.
 */
const COLUMNS = [
  { title: 'KIND', width: 16, minimum: 6, read: entry => entry.kind },
  { title: 'ID', width: 20, minimum: 6, read: entry => entry.id },
  { title: 'PORT', width: 6, minimum: 4, read: entry => entry.port },
  { title: 'PID', width: 8, minimum: 3, read: entry => entry.pid },
  { title: 'PROJECT', width: 22, minimum: 4, read: entry => entry.project },
  { title: 'AGE', width: 7, minimum: 3, read: (entry, now) => formatAge(entry.startedAt, now) },
  { title: 'STATE', width: 12, minimum: 5, read: entry => entry.state },
  // Whether this page can be seen, as the page itself reports it. `hidden`
  // covers a covered window, a minimised one and a background tab alike: all
  // three mean nobody is looking at it. A row with no attached page shows
  // nothing rather than a guess, and a dev server has no page at all.
  { title: 'SHOWING', width: 8, minimum: 7, read: entry => entry.showing }
]

/**
 * Columns dropped whole, in the order a narrow window gives them up.
 *
 * A narrow table's job is identity and liveness, so whether a page is showing
 * goes early: it is a detail a reader widens the terminal for.
 */
const DROP_FIRST = ['PROJECT', 'SHOWING', 'AGE', 'PID']
/** Columns shrunk only after the ones above are gone; identity is worth a cut. */
const SHRINKABLE = new Set(['KIND', 'ID', 'PORT', 'STATE'])

/** The width one row needs for these columns, separators included. */
const rowWidth = columns => columns.reduce((total, column) => total + column.width, 0) + 2 * (columns.length - 1)

/**
 * The columns that fit a window.
 *
 * Whole columns go first — the project, then age, then pid — because a clipped
 * value says less than a missing one. What is left is then shortened from the
 * widest until it fits, so a middle size keeps kind, id, port and state rather
 * than dropping one of them for room. A row is never wider than the window, so
 * the terminal never wraps it.
 */
function columnsFor(width) {
  let columns = COLUMNS.map(column => ({ ...column }))
  for (const gone of DROP_FIRST) {
    if (rowWidth(columns) <= width) return columns
    columns = columns.filter(column => column.title !== gone)
  }
  while (rowWidth(columns) > width) {
    const widest = columns
      .filter(column => SHRINKABLE.has(column.title) && column.width > column.minimum)
      .sort((left, right) => right.width - left.width)[0]
    if (!widest) break
    widest.width -= 1
  }
  for (const gone of ['STATE', 'PORT', 'ID']) {
    if (rowWidth(columns) <= width) break
    columns = columns.filter(column => column.title !== gone)
  }
  return columns
}

/** `engine supervisor` in full, or the short form when the window is narrow. */
function summaryLine({ port, pid, startedAt, instances }, now, width) {
  const count = `${instances.length} instance${instances.length === 1 ? '' : 's'}`
  const age = formatAge(startedAt, now)
  const full = `engine supervisor 127.0.0.1:${port ?? '-'}  pid ${pid ?? '-'}  up ${age}  ${count}`
  if (full.length <= width) return full
  return clip(`supervisor 127.0.0.1:${port ?? '-'}  up ${age}  ${count}`, width)
}

/** One table for a listing, with the supervisor's own facts above it. */
export function formatSupervisorTable(
  { port, pid, startedAt, instances = [] },
  now = Date.now(),
  width = process.stdout.columns || 80
) {
  const columns = columnsFor(width)
  const row = read =>
    columns.map(column => clip(String(read(column) ?? '-'), column.width).padEnd(column.width)).join('  ')
  return [
    summaryLine({ port, pid, startedAt, instances }, now, width),
    '',
    row(column => column.title),
    ...instances.map(entry => row(column => column.read(entry, now)))
  ].join('\n')
}

/** How many events the view draws under the table. */
const EVENT_LIMIT = 10

/**
 * The event feed, newest last, one line per event.
 *
 * The supervisor decides what happened; this only turns the time into a clock
 * reading and lines the columns up. The reading is UTC, the same clock the
 * table's ages are measured against and the JSON listing prints, so one event
 * reads as the same instant in both places. An `at` that does not parse keeps
 * its raw text rather than printing `Invalid Date` at the person.
 */
export function formatEvents(events = [], limit = EVENT_LIMIT, width = process.stdout.columns || 80) {
  if (!events.length) return 'no events yet'
  return events
    .slice(-limit)
    .map(event => {
      const parsed = new Date(event.at)
      const time = Number.isNaN(parsed.getTime()) ? String(event.at ?? '-') : parsed.toISOString().slice(11, 19)
      const line =
        `${time}  ${String(event.event).padEnd(7)} ${String(event.id).padEnd(18)} ${event.detail ?? ''}`.trimEnd()
      return clip(line, width)
    })
    .join('\n')
}

/** The supervisor's own facts, every instance, and the event feed under them. */
async function readView(checkout, width) {
  const health = await askSupervisor(checkout, 'GET', '/health', null, LIST_TIMEOUT_MILLISECONDS)
  const listed = await askSupervisor(checkout, 'GET', '/instances', null, LIST_TIMEOUT_MILLISECONDS)
  const recorded = await askSupervisor(checkout, 'GET', '/events', null, LIST_TIMEOUT_MILLISECONDS)
  const table = formatSupervisorTable(
    {
      port: health.port,
      pid: health.pid,
      startedAt: health.startedAt,
      instances: listed.instances
    },
    Date.now(),
    width
  )
  return `${table}\n\n${formatEvents(recorded.events, EVENT_LIMIT, width)}`
}

/** The window width, from the terminal if there is one. */
const windowWidth = () => process.stdout.columns || 80

/** The keys line, shortened so it fits the same window as the table. */
function keysLine(width) {
  const full =
    '[d] open dev server   [e] open editor tab   [h] open headless   [s] stop one   [a] stop all   [r] refresh   [q] quit'
  if (full.length <= width) return full
  return clip('[d]dev [e]edit [h]headless [s]stop [a]all [r]refresh [q]quit', width)
}

const openInstance = (checkout, request) =>
  askSupervisor(checkout, 'POST', '/instances', request, OPEN_TIMEOUT_MILLISECONDS)
const stopInstance = (checkout, id) =>
  askSupervisor(checkout, 'DELETE', `/instances/${encodeURIComponent(id)}`, null, STOP_TIMEOUT_MILLISECONDS)
const stopAllInstances = checkout => askSupervisor(checkout, 'DELETE', '/instances', null, STOP_TIMEOUT_MILLISECONDS)

const describeStarted = instance =>
  `opened ${instance.kind} ${instance.id}${instance.port == null ? '' : ` on port ${instance.port}`}`
const describeStopped = answer => {
  const stopped = (answer.stopped || []).map(entry => entry.id).join(', ')
  return stopped ? `stopped ${stopped}` : 'nothing to stop'
}

/**
 * Show the table and take keys until the person quits.
 *
 * `d` opens a dev server, `e` opens a visible editor tab on one, `h` opens a
 * headless one, `s` reads an id and stops it, `a` stops every owned instance,
 * `q` quits. The table redraws on a timer and after every action, and a message
 * under it says what the last action did.
 */
export async function watchSupervisor(checkout) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write((await readView(checkout, windowWidth())) + '\n')
    return
  }

  let notice = 'every engine process this checkout starts is listed here'
  // When set, the id to type; Enter stops it.
  let asking = null
  let finished = false
  let drawing = false

  const draw = async () => {
    if (drawing || finished) return
    drawing = true
    try {
      const width = windowWidth()
      const view = await readView(checkout, width)
      const prompt = asking === null ? keysLine(width) : clip(`stop which id? ${asking}`, width)
      process.stdout.write(`\x1b[2J\x1b[3J\x1b[H${view}\n\n${prompt}\n${clip(notice, width)}\n`)
    } catch (error) {
      finished = true
      process.stdout.write(`\x1b[2J\x1b[3J\x1b[Hthe supervisor is not answering: ${error.message}\n`)
    } finally {
      drawing = false
    }
  }

  const act = async run => {
    try {
      notice = await run()
    } catch (error) {
      notice = error.message
    }
    await draw()
  }

  const quit = () => {
    finished = true
    process.stdin.pause()
  }

  const onKey = (text, key) => {
    if (finished) return undefined
    if ((key.ctrl && key.name === 'c') || text === 'q') return quit()
    if (asking !== null) {
      if (key.name === 'return') {
        const id = asking
        asking = null
        return void act(async () => describeStopped(await stopInstance(checkout, id)))
      }
      if (key.name === 'escape') {
        asking = null
        notice = 'cancelled'
        return void draw()
      }
      if (key.name === 'backspace') {
        asking = asking.slice(0, -1)
        return void draw()
      }
      if (text && text.length === 1 && !key.ctrl) {
        asking += text
        return void draw()
      }
      return undefined
    }
    if (text === 'd') return void act(async () => describeStarted(await openInstance(checkout, { kind: 'dev-server' })))
    if (text === 'e')
      return void act(async () => describeStarted(await openInstance(checkout, { kind: 'editor-browser' })))
    if (text === 'h')
      return void act(async () => describeStarted(await openInstance(checkout, { kind: 'lane-browser' })))
    if (text === 'a') return void act(async () => describeStopped(await stopAllInstances(checkout)))
    if (text === 's') {
      asking = ''
      notice = 'type an instance id, then Enter'
      return void draw()
    }
    if (text === 'r') {
      notice = 'refreshed'
      return void draw()
    }
    return undefined
  }

  readline.emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  process.stdin.on('keypress', onKey)
  const timer = setInterval(() => {
    if (asking === null) draw()
  }, REFRESH_MILLISECONDS)
  timer.unref()

  await draw()
  await new Promise(resolve => {
    const wait = setInterval(() => {
      if (finished) {
        clearInterval(wait)
        resolve()
      }
    }, 50)
  })
  clearInterval(timer)
  process.stdin.off('keypress', onKey)
  if (process.stdin.isTTY) process.stdin.setRawMode(false)
}
