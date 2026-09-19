/**
 * Draft panel — the toolbar, the inspector and the picker a person works.
 *
 * Split from the plugin so the commands and persistence stay readable on their
 * own. Everything here mutates the document and calls `commit`, which the
 * plugin owns; nothing here writes a file itself.
 */
import { addNode, fitBoard, focusSpot, removeEdge, removeNode, setEdge, setNode } from './model.js'
import { mountStage } from './view.js'

export function renderPanel(ui, context, state, commit) {
  state.mount?.dispose()
  state.mount = null
  if (!state.doc) return picker(ui, context, state)

  const stage = document.createElement('div')
  stage.style.cssText = 'position:relative;flex:1;min-height:0'
  const canvas = document.createElement('canvas')
  canvas.tabIndex = 0
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;cursor:default'
  stage.append(canvas)
  state.mount = mountStage({
    stage,
    canvas,
    state,
    actions: { commit: () => commit(context), redraw: () => context.redraw() }
  })

  const toolbar = ui.row([
    ui.button('Text', () => addAndEdit(context, state, commit, 'text')),
    ui.button('Note', () => addAndEdit(context, state, commit, 'note')),
    ui.button('Image', () => addAndEdit(context, state, commit, 'image')),
    ui.button('Group', () => addAndEdit(context, state, commit, 'group')),
    ui.spacer(),
    ui.button('Fit', () => { fitBoard(state); context.redraw() })
  ], { pad: true })

  const panel = ui.stack([
    toolbar,
    ui.raw(stage),
    state.error ? ui.text(state.error, { dim: true }) : null,
    inspector(ui, context, state, commit)
  ].filter(Boolean))
  // The stack must fill the panel body, or the stage has no height to flex into.
  panel.style.height = '100%'
  return panel
}

function picker(ui, context, state) {
  return ui.stack([
    ui.text('A draft is a board: text, notes, images and groups, joined by arrows. ' +
      'It saves itself, and an agent reads and writes the same board with draft.read, draft.plan and draft.add.', { dim: true }),
    ui.list({
      items: state.saved,
      key: (draft) => draft.id,
      emptyText: 'no drafts saved yet',
      row: (draft) => [ui.label(draft.title || draft.id), ui.spacer(), ui.meta(`${draft.nodes}→${draft.edges}`)],
      onPick: (draft) => context.run('draft.open', { id: draft.id })
    }),
    ui.row([
      ui.button('New draft', () => context.run('draft.new', { title: 'Untitled' }), { primary: true }),
      ui.button('Refresh', () => context.run('draft.list').then(() => context.redraw()))
    ], { pad: true })
  ])
}

function inspector(ui, context, state, commit) {
  const selected = state.selected
  if (!selected) {
    return ui.text('wheel zooms · drag the background to pan · double-click a box to type · drag its right dot to draw an arrow', { dim: true })
  }
  if (selected.startsWith('e:')) {
    const edge = state.doc.edges.find((entry) => entry.id === selected.slice(2))
    if (!edge) return ui.text('nothing selected', { dim: true })
    return ui.fold(`arrow ${edge.from} → ${edge.to}`, [
      ui.field({ k: 'label', v: edge.text, onChange: (value) => change(context, state, commit, () => setEdge(state.doc, edge.id, { text: value })) }),
      ui.row([ui.button('Delete arrow', () => removeSelected(context, state, commit))], { pad: true })
    ], { open: true })
  }
  const node = state.doc.nodes.find((entry) => entry.id === selected.slice(2))
  if (!node) return ui.text('nothing selected', { dim: true })
  const sized = node.kind === 'image' || node.kind === 'group'
  return ui.fold(`box ${node.id}`, [
    ui.field({
      k: 'text',
      v: node.text,
      note: node.kind === 'image' ? 'asset path' : '',
      onChange: (value) => change(context, state, commit, () => setNode(state.doc, node.id, { text: value }))
    }),
    ui.field({
      k: 'at',
      v: node.at.join(', '),
      onChange: (value) => change(context, state, commit, () => setNode(state.doc, node.id, { at: value.split(',').map(Number) }))
    }),
    ui.field({
      k: 'w',
      v: node.w ?? '',
      kind: 'number',
      onChange: (value) => change(context, state, commit, () => setNode(state.doc, node.id, { w: Number(value) }))
    }),
    ...(sized ? [ui.field({
      k: 'h',
      v: node.h ?? '',
      kind: 'number',
      onChange: (value) => change(context, state, commit, () => setNode(state.doc, node.id, { h: Number(value) }))
    })] : []),
    ui.row([ui.button('Delete box', () => removeSelected(context, state, commit))], { pad: true })
  ], { open: true })
}

/** One mutation from the panel: apply, save, redraw, and keep a refusal visible. */
function change(context, state, commit, mutate) {
  try { mutate(); state.error = null }
  catch (error) { state.error = error.message }
  commit(context)
}

function addAndEdit(context, state, commit, kind) {
  try {
    const node = addNode(state.doc, { kind, text: '', at: focusSpot(state) })
    state.selected = `n:${node.id}`
    if (kind !== 'image') state.editing = node.id
    state.error = null
  } catch (error) {
    state.error = error.message
  }
  commit(context)
}

function removeSelected(context, state, commit) {
  try {
    if (state.selected?.startsWith('n:')) removeNode(state.doc, state.selected.slice(2))
    else if (state.selected?.startsWith('e:')) removeEdge(state.doc, state.selected.slice(2))
    state.selected = null
    state.error = null
  } catch (error) {
    state.error = error.message
  }
  commit(context)
}
