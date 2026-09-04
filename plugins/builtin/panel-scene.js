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

      return ui.stack([
        all.length > 8 && ui.search({ bind: 'q', placeholder: 'filter', count: hits.length }),
        ui.list({
          items: hits,
          key: e => e.id,
          selected: [...context.editor.selection][0],
          emptyText: 'level is empty',
          row: e => [
            ui.label(e.id),
            ui.spacer(),
            e.overrides.length ? ui.raw(mark('·')) : null
          ],
          onPick: (e, event) => { context.select(e, event.shiftKey); context.redraw() }
        })
      ])
    }
  }],

  commands: [
    {
      id: 'scene.selectAll',
      label: 'Select all entities',
      run: context => context.select(context.world.entities.map(e => e.id))
    },
    {
      id: 'scene.deleteSelected',
      label: 'Delete selection',
      run: context => { context.selection.forEach(e => context.destroy(e)); context.save() }
    }
  ]
}

function mark(text) {
  const s = document.createElement('span')
  s.textContent = text
  s.style.color = 'var(--mark)'
  s.title = 'has overrides'
  return s
}
