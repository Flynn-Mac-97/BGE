/**
 * Scene tree. Rows here SELECT — that is this tree's verb, and it is the whole
 * reason it is not confusable with the Project tree next to it.
 */
export default {
  name: 'Scene Panel',

  category: 'editor',
  panels: [{
    id: 'scene',
    title: 'Scene · select',
    dock: 'left',
    order: 10,

    render(ui, context) {
      const q = (context.state.q || '').toLowerCase()
      const all = context.world.entities
      const hits = q ? all.filter(e => (e.id + e.type).toLowerCase().includes(q)) : all
      const selected = [...context.editor.selection][0]
      const shown = rowsToDraw(hits, selected)

      return ui.stack([
        all.length > 8 && ui.search({ bind: 'q', placeholder: 'filter', count: hits.length }),
        ui.list({
          items: shown,
          key: e => e.id,
          selected,
          emptyText: 'level is empty',
          row: e => [
            ui.label(e.id),
            ui.spacer(),
            e.overrides.length ? ui.raw(mark('·')) : null
          ],
          onPick: (e, event) => { context.select(e, event.shiftKey); context.redraw() }
        }),
        shown.length < hits.length && ui.empty(`${hits.length - shown.length} more — filter to find one`)
      ])
    }
  }],

  commands: [
    {
      id: 'scene.selectAll',
      label: 'Select all',
      run: context => context.select(context.world.entities.map(e => e.id))
    },
    {
      id: 'scene.deleteSelected',
      label: 'Delete selection',
      run: context => { context.selection.forEach(e => context.destroy(e)); context.save() }
    }
  ]
}

/**
 * Every panel is rebuilt on each redraw, and a row is several DOM nodes. At
 * fifty thousand entities the full list took over a second per click, so only
 * the first rows are drawn. The selected entity is always one of them.
 */
const MOST_ROWS = 500

function rowsToDraw(hits, selectedId) {
  if (hits.length <= MOST_ROWS) return hits
  const shown = hits.slice(0, MOST_ROWS)
  const selected = selectedId === undefined ? null : hits.find(e => e.id === selectedId)
  if (selected && !shown.includes(selected)) shown.push(selected)
  return shown
}

function mark(text) {
  const s = document.createElement('span')
  s.textContent = text
  s.style.color = 'var(--mark)'
  s.title = 'has overrides'
  return s
}
