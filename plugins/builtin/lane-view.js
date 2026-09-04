/**
 * Lane View — what each lane is doing, in the person's own tab, read only.
 *
 * A lane drives its own headless browser, so the person can see none of them.
 * This shows one selected lane two ways: a schematic of what the lane reports,
 * and the last real frame that lane wrote. They are labelled as different
 * things, and a missing frame is never filled in with a diagram.
 *
 * Reaching a lane needs no new transport. The page posts `/api/engine` with a
 * `client` field, as the CLI does. `snapshot` and `see.describe` are reads, so
 * the work lock answers them while it holds, which is what makes watching a
 * working lane possible.
 *
 * The geometry is the engine's. `see.describe` returns each visible entity's
 * screen centre, size and hull as percentages of the frame, plus the colour the
 * engine gives its type, so this file projects nothing.
 *
 * Only the selected lane is polled. Polling all of them would put five bridge
 * round trips on the wire for four pictures nobody is looking at.
 */

/** Every op this viewer may send. A viewer that can write is not a viewer. */
const READS = new Set(['snapshot', 'see.describe'])

const POLL_MILLISECONDS = 1200

/** Past this, reported state is dated rather than live, however it was read. */
const STALE_AFTER_MILLISECONDS = 4000

/** The nearest bodies make the diagram; a whole level makes a grey rectangle. */
const MOST_SHAPES = 200

/**
 * A schematic is pixels, not a panel, so it names its own backdrop and the one
 * grey a dated diagram uses. Every other colour in it comes from `describe`.
 */
const BACKDROP = '#111114'
const DATED_INK = '#6f6f74'

const state = { open: false, selected: null, lanes: [], lanesAt: 0, lanesWhy: null, watching: new Map() }

export default {
  name: 'Lane View',

  category: 'agents',
  about: 'Shows one lane at a time: a schematic the lane\'s own engine computed from see.describe, and ' +
    'the last frame that lane captured, each labelled and each dated. It polls only the lane you are ' +
    'looking at, and sends nothing but reads.',

  needs: ['Terminal Bridge'],

  inspect: () => [{
    title: 'Lane View',
    rows: [
      ['lanes', String(state.lanes.length)],
      ['watching', state.selected || 'none'],
      ['polling', state.open ? `every ${POLL_MILLISECONDS} ms` : 'closed'],
      ['sends', [...READS].join(', ')]
    ]
  }],

  menus: [{
    id: 'lane-view',
    label: 'LANES',
    title: 'Watch what a lane is doing',
    on: () => state.open,
    run: context => context.run('lane.view')
  }],

  panels: [{
    id: 'lane-view',
    title: 'Lanes · watch one',
    dock: 'centre',
    order: 30,
    when: () => state.open,

    actions: [{
      label: 'Close ×',
      title: 'Close the lane viewer',
      run: context => context.run('lane.view')
    }],

    render(ui, context) {
      const watch = state.selected ? state.watching.get(state.selected) : null
      const shown = laneView(watch)
      return ui.stack([
        laneChooser(ui, context),
        ...(state.selected ? [
          halfPanel(ui, 'Schematic · a diagram, computed from reported state', shown.schematic, shown.schematic.image),
          halfPanel(ui, 'Last capture · a real frame, written by this lane', shown.frame, shown.frame.url),
          laneFacts(ui, watch)
        ] : []),
        ui.text('Read only. This panel sends snapshot and see.describe and nothing else, so it can watch ' +
          'a lane that holds the work lock without touching it.', { dim: true })
      ])
    }
  }],

  commands: [
    {
      id: 'lane.view',
      label: 'Open or close the lane viewer',
      run: context => {
        // A headless world has no panel and no server to poll; a timer there
        // would run forever catching its own failed fetches.
        if (!context.shell) return { open: false, why: 'this is a headless world — there is no panel' }
        state.open = !state.open
        state.open ? startPolling(context) : stopPolling()
        context.redraw()
        return { open: state.open, watching: state.selected, lanes: state.lanes.map(lane => lane.client) }
      }
    },

    {
      id: 'lane.watch',
      label: 'Watch one lane by client name — the only lane polled',
      async run(context, name) {
        const wanted = String([].concat(name ?? [])[0] ?? '').trim()
        if (!context.shell) {
          return { watched: false, why: 'a headless world has no dev server to ask', lanes: [] }
        }
        await readLanes()
        if (wanted && !state.lanes.some(lane => lane.client === wanted)) {
          throw new Error(`no lane "${wanted}". Attached now: ${state.lanes.map(lane => lane.client).join(', ') || 'none'}`)
        }
        state.selected = wanted || state.lanes[0]?.client || null
        if (state.selected) await readLane(state.selected)
        context.redraw()
        return report()
      }
    },

    {
      id: 'lane.report',
      label: 'What the lane viewer is showing, and when each half was taken',
      run: () => report()
    }
  ]
}

/**
 * The exact request body for one lane read, or a refusal. Pure and separate, so
 * a test can watch the read-only rule refuse rather than take it on trust.
 */
export function askBody(client, verb, options) {
  if (!READS.has(verb)) throw new Error(`Lane View is read only and will not send "${verb}"`)
  if (!client) throw new Error('a lane read must name its client')
  return verb === 'snapshot'
    ? { op: 'snapshot', args: [], client, timeout: 4000 }
    : { op: 'run', args: [verb, options || {}], client, timeout: 4000 }
}

/**
 * What the two panels will show, as data. Pure, so a test can prove the
 * schematic comes from `describe`'s geometry, that a missing capture stays
 * missing, and that dated state says so.
 */
export function laneView(watch, now = Date.now()) {
  const answering = !!watch?.answering
  const dated = !answering || now - (watch.shownAt || 0) > STALE_AFTER_MILLISECONDS

  const schematic = watch?.shown
    ? { label: `${dated ? 'SCHEMATIC · DATED' : 'SCHEMATIC'} — a diagram of reported state, not a frame` +
          ` · ${clock(watch.shownAt)} · ${age(now, watch.shownAt)}`,
        image: schematicImage(watch.shown, dated), at: watch.shownAt, dated }
    : { label: 'SCHEMATIC — nothing reported yet', dated: true,
        why: watch?.why || 'this lane has not answered a read' }

  const frame = watch?.frame
    ? { label: `CAPTURE — a real frame this lane wrote · ${watch.frame.how || 'at'}` +
          ` ${clock(watch.frame.at)} · ${age(now, watch.frame.at)}` +
          (watch.frame.bytes ? ` · ${Math.round(watch.frame.bytes / 1024)} kB` : ''),
        url: watch.frame.url, at: watch.frame.at }
    : { label: 'CAPTURE — no frame yet', why: watch?.frameWhy || 'not read yet' }

  return { client: watch?.client || null, answering, dated, schematic, frame }
}

/**
 * The diagram, as an SVG data URL.
 *
 * `at` and `size` are percentages of the frame and the viewBox is 0-100, so a
 * body lands where the lane's own projector put it. Far bodies draw first, so a
 * near one covers them as it does on screen. A dated diagram drops the engine's
 * colours for one grey: a live-looking picture of old state is what this panel
 * exists to prevent.
 */
function schematicImage(shown, dated) {
  const palette = shown.palette || {}
  const bodies = [...(shown.visible || [])]
    .sort((a, b) => (a.depth || 0) - (b.depth || 0))
    .slice(0, MOST_SHAPES)
    .reverse()
    .map(body => shape(body, dated ? DATED_INK : palette[body.type] || DATED_INK))
  const width = Math.round(shown.viewport?.width || 320)
  const height = Math.round(shown.viewport?.height || 180)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"` +
    ` viewBox="0 0 100 100" preserveAspectRatio="none">` +
    `<rect width="100" height="100" fill="${BACKDROP}"/>${bodies.join('')}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** A hull if the engine computed one, else the reported screen box. */
function shape(body, ink) {
  const paint = `fill="${ink}" fill-opacity="0.35" stroke="${ink}" stroke-width="1" vector-effect="non-scaling-stroke"`
  if (body.hull?.length >= 3) {
    return `<polygon points="${body.hull.map(point => `${point[0]},${point[1]}`).join(' ')}" ${paint}/>`
  }
  const [x, y] = body.at || [50, 50]
  const [w, h] = body.size || [1, 1]
  return `<rect x="${x - w / 2}" y="${y - h / 2}" width="${Math.max(w, 0.4)}" height="${Math.max(h, 0.4)}" ${paint}/>`
}

// ---- panels ----

function laneChooser(ui, context) {
  const options = state.lanes.map(lane => ({ value: lane.client, label: lane.client }))
  return ui.stack([
    ui.row([
      ui.label('Lanes'), ui.meta(`${state.lanes.length} attached`), ui.spacer(),
      ui.meta(state.lanesWhy || (state.lanesAt ? `list read ${clock(state.lanesAt)}` : 'not read yet'))
    ]),
    options.length
      ? ui.pick({ options, value: state.selected, onChange: value => context.run('lane.watch', value) })
      : ui.empty('no lane browser attached — node bin/engine.mjs lanes.start <name>')
  ])
}

/** One labelled half. The caller names its picture, so neither can take the other's. */
const halfPanel = (ui, title, part, picture) => ui.section(title, [
  picture ? ui.picture(picture, { label: part.label }) : ui.empty(`${part.label} — ${part.why}`)
])

function laneFacts(ui, watch) {
  const lane = state.lanes.find(entry => entry.client === state.selected)
  const shown = watch?.shown
  return ui.section('This lane', [
    ui.field({ k: 'client', v: state.selected }),
    ui.field({ k: 'answering', v: watch?.answering ? 'yes' : `no — ${watch?.why || 'not read yet'}` }),
    ui.field({ k: 'profile asked', v: lane?.profile || 'unreported' }),
    ui.field({ k: 'project', v: shown?.project ?? 'unreported' }),
    ui.field({ k: 'level', v: shown?.level ?? 'unreported' }),
    ui.field({ k: 'visible', v: shown?.counts?.visible ?? 'unreported' }),
    ui.field({ k: 'camera', v: shown?.camera?.mode ?? 'unreported' })
  ])
}

// ---- polling ----

let timer = null
let inFlight = false

function startPolling(context) {
  if (timer) return
  // Wall clock and a browser timer, not engine time: this measures another
  // process's answers and feeds nothing the world simulates.
  timer = setInterval(() => { poll(context) }, POLL_MILLISECONDS)
  poll(context)
}

const stopPolling = () => { clearInterval(timer); timer = null }

/** One round: the lane list, then the selected lane only. */
async function poll(context) {
  if (inFlight) return
  inFlight = true
  try {
    await readLanes()
    if (!state.lanes.some(lane => lane.client === state.selected)) {
      state.selected = state.lanes[0]?.client || null
    }
    if (state.selected) await readLane(state.selected)
  } finally {
    inFlight = false
    context.redraw()
  }
}

/**
 * Which lanes exist, from the server. `lanes` is the lane-browser registry. A
 * server without that field still knows which attached pages called themselves
 * headless, and a lane render page is one, so the tab list answers instead.
 */
async function readLanes() {
  try {
    const body = await (await fetch('/api/server', { cache: 'no-store' })).json()
    const lanes = Array.isArray(body.lanes) ? body.lanes.map(laneRecord) : []
    state.lanes = lanes.length ? lanes : (body.tabs || []).filter(tab => tab.headless).map(tabRecord)
    state.lanesAt = Date.now()
    state.lanesWhy = null
  } catch (error) {
    state.lanesWhy = `lane list unread: ${String(error?.message || error)}`
  }
}

const laneRecord = entry => ({
  client: entry.client,
  url: entry.url,
  profile: [entry.viewportReported || entry.windowAsked, entry.pixelRatio && `@${entry.pixelRatio}x`]
    .filter(Boolean).join(' ')
})

const tabRecord = tab => ({ client: tab.id, url: tab.url, profile: tab.viewport })

function watchOf(client) {
  if (!state.watching.has(client)) {
    state.watching.set(client,
      { client, shown: null, shownAt: 0, answering: false, why: null, frame: null, frameWhy: null })
  }
  return state.watching.get(client)
}

const readLane = async client => { await readState(client); await readFrame(client) }

async function readState(client) {
  const watch = watchOf(client)
  try {
    // `about: false` drops the authored prose; a diagram cannot draw a sentence.
    const body = await postEngine(askBody(client, 'see.describe', { about: false }))
    if (!body.ok) throw new Error(body.error || body.code || 'the lane did not answer')
    watch.shown = body.result
    watch.shownAt = Date.now()
    watch.answering = true
    watch.why = null
  } catch (error) {
    watch.answering = false
    watch.why = String(error?.message || error)
  }
}

/**
 * Whether this lane has a frame, and how old it is. A HEAD, so a poll never
 * carries the picture — the img element fetches that once per new capture,
 * keyed by the frame name in its URL. A HEAD says nothing but its status, so a
 * refusal is read again to learn which refusal it is.
 */
async function readFrame(client) {
  const watch = watchOf(client)
  // No leading slash: ui.picture adds one, and a source that already has it breaks.
  const where = `api/lane-frame?client=${encodeURIComponent(client)}`
  try {
    const head = await fetch(`/${where}`, { method: 'HEAD', cache: 'no-store' })
    if (head.ok) return keepFrame(watch, where, head.headers)
    const body = await (await fetch(`/${where}`, { cache: 'no-store' })).json().catch(() => null)
    watch.frame = null
    watch.frameWhy = body?.error === 'no such endpoint'
      ? 'this server has no /api/lane-frame route'
      : body?.error || 'this lane has captured nothing'
  } catch (error) {
    watch.frame = null
    watch.frameWhy = String(error?.message || error)
  }
}

/**
 * Date the capture from the response, or from when this viewer first saw it.
 * `/api/lane-frame` names the frame file and sends no date for it, and taking
 * the poll time would make an hour-old frame read as new, so an undated one
 * says which of the two dates it carries.
 */
function keepFrame(watch, where, headers) {
  const name = headers.get('x-engine-frame') || ''
  const written = Date.parse(headers.get('last-modified'))
  const known = Number.isFinite(written) ? written : watch.frame?.name === name ? watch.frame.at : Date.now()
  watch.frame = {
    name,
    url: `${where}&frame=${encodeURIComponent(name || Date.now())}`,
    at: known,
    how: Number.isFinite(written) ? 'written' : 'first seen',
    bytes: Number(headers.get('content-length')) || 0
  }
  watch.frameWhy = null
}

const postEngine = async body => (await fetch('/api/engine',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()

const told = half => ({ label: half.label, at: iso(half.at), ...(half.why ? { why: half.why } : {}) })

/** What a terminal gets: the same two halves, dated, without the pictures. */
function report() {
  const watch = state.selected ? state.watching.get(state.selected) : null
  const shown = laneView(watch)
  return {
    open: state.open,
    lanes: state.lanes.map(lane => lane.client),
    watching: shown.client,
    answering: shown.answering,
    schematic: told(shown.schematic),
    frame: told(shown.frame),
    level: watch?.shown?.level ?? null,
    visible: watch?.shown?.counts?.visible ?? null
  }
}

const clock = ms => new Date(ms).toTimeString().slice(0, 8)
const iso = ms => (ms ? new Date(ms).toISOString() : null)
const age = (now, at) => `${Math.round((now - at) / 100) / 10} s old`
