/**
 * Draft — a board a person and an agent both edit, for planning a mechanic, a
 * system or a mood before any of it is code.
 *
 * A person draws it on the panel: text, notes, images, groups, arrows. An agent
 * reads it as data and writes it back with one call. Both write the same
 * document through the engine's document store, so the saved draft is the one
 * truth and there is no save button.
 *
 * The shapes an agent uses are in `draft/model.js`, the canvas in
 * `draft/view.js`, the panel in `draft/panel.js`. This file is the plugin:
 * state, persistence and commands.
 */
import {
  addEdge, addNode, docFromPlan, fitBoard, focusSpot, normalizeDoc, outlineText,
  removeEdge, removeNode, setEdge, setNode, slug, toPlan
} from './draft/model.js'
import { renderPanel } from './draft/panel.js'

/** Drafts live in the engine's document store, under this id prefix. */
const PREFIX = 'draft-'

const state = {
  open: false,
  id: null,
  doc: null,
  revision: null,
  saved: [],
  view: { x: 0, y: 0, zoom: 1 },
  selected: null,
  editing: null,
  error: null,
  stageSize: null,
  fitPending: false,
  mount: null
}

const documentId = (id) => {
  const raw = String(id ?? '').trim().toLowerCase()
  const stem = raw.startsWith(PREFIX) ? raw.slice(PREFIX.length) : raw
  return PREFIX + (slug(stem) || 'untitled')
}
const idOf = (options) => typeof options === 'string' ? options : options?.id
const titleOf = (options) => typeof options === 'string' ? options : options?.title

/** Point the open document at a stored draft. Answers whether one was there. */
async function load(context, id) {
  const stored = await context.files.readDocument(documentId(id)).catch(() => null)
  if (!stored?.data || stored.data.kind !== 'draft') return false
  state.id = documentId(id)
  state.doc = normalizeDoc(stored.data)
  state.revision = stored.revision
  state.error = null
  return true
}

async function save(context) {
  const written = await context.files.writeDocument(state.id, state.doc, state.revision)
  state.revision = written?.revision ?? state.revision
}

/** Save and redraw. A refused write is kept in `state.error` for the caller. */
async function commit(context) {
  try {
    await save(context)
    state.error = null
  } catch (error) {
    state.error = error.message
  }
  context.redraw()
}

/** The open draft, opening the named one first when it is a different draft. */
async function ensure(context, options) {
  const wanted = idOf(options)
  if (wanted && documentId(wanted) !== state.id && !await load(context, wanted)) {
    throw new Error(`no draft "${documentId(wanted)}"`)
  }
  if (!state.doc) throw new Error('no draft is open — draft.open <id>, or draft.plan to start one')
  return state.doc
}

async function listDrafts(context) {
  const listed = await context.files.listDocuments()
  const documents = Array.isArray(listed) ? listed : listed?.documents ?? []
  const found = []
  for (const entry of documents) {
    if (!String(entry.id).startsWith(PREFIX)) continue
    const stored = await context.files.readDocument(entry.id).catch(() => null)
    const data = stored?.data
    if (!data || data.kind !== 'draft') continue
    found.push({
      id: entry.id,
      title: data.title,
      nodes: data.nodes?.length ?? 0,
      edges: data.edges?.length ?? 0,
      updatedAt: stored.updatedAt
    })
  }
  return found.sort((first, second) => first.id.localeCompare(second.id))
}

/** A document id no saved draft holds, so a new title never overwrites one. */
async function freeId(context, title) {
  const taken = new Set((await listDrafts(context)).map((draft) => draft.id))
  const base = (slug(title) || 'untitled').replace(new RegExp(`^${PREFIX}`), '')
  let stem = base
  let n = 1
  while (taken.has(stem)) stem = `${base}-${++n}`
  return PREFIX + stem
}

function reply() {
  return { id: state.id, revision: state.revision, outline: outlineText(state.id, state.doc) }
}

async function planDraft(context, options) {
  const wanted = options?.id ? documentId(options.id) : null
  let base = null
  let revision = null
  if (wanted) {
    if (state.id === wanted && state.doc) {
      base = state.doc
      revision = state.revision
    } else if (await load(context, wanted)) {
      base = state.doc
      revision = state.revision
    }
  }
  const doc = docFromPlan(options ?? {}, base)
  state.id = wanted ?? await freeId(context, doc.title)
  state.doc = doc
  state.revision = revision
  state.open = true
  state.selected = null
  state.editing = null
  state.error = null
  if (!base) state.view = { x: 0, y: 0, zoom: 1 }
  state.fitPending = true
  await save(context)
  context.redraw()
  return reply()
}

export default {
  name: 'Draft',

  category: 'editor',
  about: 'A shared board for planning a mechanic, system or mood.',

  inspect: () => [{
    title: 'Draft',
    rows: [
      ['open', state.id ?? 'none'],
      ['nodes', state.doc?.nodes.length ?? 0],
      ['edges', state.doc?.edges.length ?? 0],
      ['saved', state.saved.length]
    ]
  }],

  menus: [{
    id: 'draft.board',
    label: 'DRAFT',
    title: 'Plan a diagram with a person or an agent',
    on: () => state.open,
    run: (context) => context.run('draft.panel')
  }],

  onLoad(context) {
    context.draft = {
      get open() { return state.id ? { id: state.id, title: state.doc?.title } : null },
      list: () => listDrafts(context)
    }
  },

  panels: [{
    id: 'draft',
    title: 'Draft · plan a diagram',
    dock: 'centre',
    order: 5,
    scroll: false,
    when: () => state.open,

    actions: [
      { label: 'New', run: (context) => context.run('draft.new', { title: 'Untitled' }) },
      {
        label: 'Close ×',
        title: 'Close the board',
        run: () => { state.open = false; state.mount?.dispose(); state.mount = null }
      }
    ],

    render: (ui, context) => renderPanel(ui, context, state, commit)
  }],

  commands: [
    {
      id: 'draft.panel',
      label: 'Show or hide the draft board',
      async run(context) {
        if (!context.shell) return { open: false, why: 'this is a headless world — there is no panel' }
        state.open = !state.open
        if (state.open) state.saved = await listDrafts(context)
        context.redraw()
        return { open: state.open, drafting: state.id }
      }
    },

    {
      id: 'draft.list',
      label: 'List saved drafts',
      async run(context) {
        state.saved = await listDrafts(context)
        return { drafts: state.saved }
      }
    },

    {
      id: 'draft.new',
      label: 'Start a draft',
      // args: {title} or a bare title
      run: (context, options) => planDraft(context, { title: titleOf(options) || 'Untitled', nodes: [], edges: [] })
    },

    {
      id: 'draft.plan',
      label: 'Write a whole draft from a plan',
      // args: {title, nodes:[[id,kind,text,at?]], edges:[[from,to,label?]]} — id replaces that draft
      run: (context, options) => planDraft(context, options ?? {})
    },

    {
      id: 'draft.open',
      label: 'Open a saved draft',
      async run(context, options) {
        const wanted = idOf(options)
        if (!wanted) throw new Error('draft.open needs an id — see draft.list')
        if (!await load(context, wanted)) throw new Error(`no draft "${documentId(wanted)}"`)
        state.open = true
        state.fitPending = true
        state.selected = null
        state.editing = null
        context.redraw()
        return reply()
      }
    },

    {
      id: 'draft.read',
      label: 'Read a draft as data',
      async run(context, options) {
        await ensure(context, options)
        return { id: state.id, revision: state.revision, ...toPlan(state.doc) }
      }
    },

    {
      id: 'draft.show',
      label: 'Read a draft as words',
      async run(context, options) {
        await ensure(context, options)
        return { id: state.id, title: state.doc.title, outline: outlineText(state.id, state.doc) }
      }
    },

    {
      id: 'draft.fit',
      label: 'Frame the whole board',
      async run(context, options) {
        await ensure(context, options)
        fitBoard(state)
        context.redraw()
        return { id: state.id, view: state.view }
      }
    },

    {
      id: 'draft.add',
      label: 'Add a node',
      // args: {id?, kind?, text?, at?, w?, h?, colour?}
      async run(context, options) {
        const doc = await ensure(context, options)
        const node = addNode(doc, {
          kind: options?.kind,
          text: options?.text,
          at: options?.at ?? focusSpot(state),
          w: options?.w,
          h: options?.h,
          colour: options?.colour
        })
        state.selected = `n:${node.id}`
        await commit(context)
        if (state.error) throw new Error(state.error)
        return { ...reply(), node: node.id }
      }
    },

    {
      id: 'draft.set',
      label: 'Change a node',
      // args: {id?, node, text?, kind?, at?, w?, h?, colour?}
      async run(context, options) {
        const doc = await ensure(context, options)
        if (!options?.node) throw new Error('draft.set needs a node id')
        setNode(doc, options.node, options)
        await commit(context)
        if (state.error) throw new Error(state.error)
        return reply()
      }
    },

    {
      id: 'draft.connect',
      label: 'Point one node at another',
      // args: {id?, from, to, text?}
      async run(context, options) {
        const doc = await ensure(context, options)
        if (!options?.from || !options?.to) throw new Error('draft.connect needs "from" and "to"')
        const edge = addEdge(doc, { from: options.from, to: options.to, text: options.text })
        await commit(context)
        if (state.error) throw new Error(state.error)
        return { ...reply(), edge: edge.id }
      }
    },

    {
      id: 'draft.label',
      label: 'Label an arrow',
      // args: {id?, edge, text}
      async run(context, options) {
        const doc = await ensure(context, options)
        if (!options?.edge) throw new Error('draft.label needs an edge id')
        setEdge(doc, options.edge, { text: options.text ?? '' })
        await commit(context)
        if (state.error) throw new Error(state.error)
        return reply()
      }
    },

    {
      id: 'draft.remove',
      label: 'Remove a node or an arrow',
      // args: {id?, node?|edge?}
      async run(context, options) {
        const doc = await ensure(context, options)
        if (!options?.edge && !options?.node) throw new Error('draft.remove needs a node or an edge id')
        const removed = options.edge ? removeEdge(doc, options.edge) : removeNode(doc, options.node)
        state.selected = null
        await commit(context)
        if (state.error) throw new Error(state.error)
        return {
          ...reply(),
          removed: removed.node ? `node ${removed.node} and ${removed.edges} edge(s)` : `edge ${removed.edge}`
        }
      }
    }
  ]
}
