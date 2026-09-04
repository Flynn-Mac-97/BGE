/**
 * Project browser. Rows here OPEN — the second verb, which is what stops two
 * trees in one column from being ambiguous.
 *
 * Search reads the generated index, so it matches what things *are*: a type's
 * properties, an asset's users, a level's contents. Not just filenames.
 */
const KINDS = [
  ['type',  'Types'],
  ['behaviour', 'Behaviours'],
  ['level', 'Levels'],
  ['test',  'Tests'],
  ['image', 'Images'],
  ['sound', 'Sounds'],
  ['model', 'Models']
]

const MODES = ['by kind', 'by level', 'flat']

/** Returns '' for a name hit, a short reason for an indirect hit, or null for no match. */
function reason(item, q) {
  if (!q) return ''
  const k = q.toLowerCase()
  const has = s => String(s || '').toLowerCase().includes(k)

  if (has(item.name)) return ''
  if (has(item.file)) return 'path'
  if (item.properties?.some(has)) return 'prop ' + item.properties.find(has)
  if (item.uses?.some(has)) return 'uses ' + item.uses.find(has)
  if (item.types?.some(has)) return 'has ' + item.types.find(has)
  if (item.usedBy?.some(has)) return 'used by ' + item.usedBy.find(has)
  if (has(item.kind)) return 'kind'
  if (k === 'unused' || k === 'orphan') return isOrphan(item) ? 'unreferenced' : null
  return null
}

const isOrphan = i => (i.kind === 'image' || i.kind === 'sound') && !(i.usedBy || []).length

function everything(context) {
  const index = context.editor.index
  return [
    ...Object.entries(index.types).map(([name, t]) => ({ name, kind: 'type', ...t })),
    // A behaviour's properties are name→default, unlike a type's; search wants the
    // names, so flatten them to the same shape everything else here uses.
    ...Object.entries(index.behaviours || {}).map(([name, b]) => ({
      name, kind: 'behaviour', ...b, properties: Object.keys(b.properties || {})
    })),
    ...Object.entries(index.levels).map(([name, l]) => ({ name, kind: 'level', ...l })),
    ...Object.entries(index.tests || {}).map(([name, t]) => ({ name, kind: 'test', ...t })),
    ...Object.entries(index.assets).map(([name, a]) => ({ name, ...a }))
  ]
}

export default {
  name: 'Project Panel',

  category: 'editor',
  panels: [{
    id: 'project',
    title: 'Project · open',
    dock: 'left',
    order: 20,

    actions: [
      {
        label: '+',
        title: 'New type, behaviour, level, test or plugin',
        run: context => { context.editor._creating = !context.editor._creating }
      },
      {
        label: 'kind',
        title: 'Change grouping',
        run: context => {
          const s = context.editor._projMode = ((context.editor._projMode ?? 0) + 1) % MODES.length
          context.editor._projModeLabel = MODES[s]
        }
      }
    ],

    render(ui, context) {
      const q = context.state.q || ''
      const mode = context.editor._projMode ?? 0
      const items = everything(context)
        .map(it => ({ it, why: reason(it, q) }))
        .filter(r => r.why !== null)

      const row = ({ it, why }) => [
        ui.label(it.name),
        why ? ui.meta(why) : null,
        ui.spacer(),
        ui.meta(it.kind === 'type' ? `${it.inLevels || 0} lvl`
              : it.kind === 'level' ? `${it.entities || 0}`
              : it.kind === 'test' ? (it.level || '')
              : (it.usedBy || []).length ? `${it.usedBy.length}` : '')
      ]

      const open = it => {
        if (it.kind === 'level') context.editor.loadLevel(it.name).then(context.redraw)
        else context.open(it.file)
        context.editor._file = it
        context.redraw()
      }

      const list = extra => ui.list({
        items: extra, key: r => r.it.name,
        selected: context.editor._file?.name,
        dim: r => isOrphan(r.it),
        row, onPick: r => open(r.it),
        // Two things can be dragged out of here, and where you let go decides
        // what happens: a type dropped on empty space places one, a behaviour
        // dropped on an entity attaches to it. Rows still open on click —
        // dragging is the second gesture, not a mode.
        drag: r => (r.it.kind === 'type' || r.it.kind === 'behaviour'
          ? { kind: r.it.kind, name: r.it.name }
          : null),
        emptyText: q ? `no match for “${q}”` : 'empty project'
      })

      const body =
        mode === 0
          ? ui.stack(KINDS.map(([k, label]) => {
              const rows = items.filter(r => r.it.kind === k)
              return rows.length ? ui.section(`${label} · ${rows.length}`, [list(rows)]) : null
            }).filter(Boolean))
          : mode === 1
            ? ui.stack(items.filter(r => r.it.kind === 'level').map(({ it }) => {
                const inLevel = items.filter(r => (it.types || []).includes(r.it.name))
                return ui.section(it.name, [list(inLevel)])
              }))
            : list(items)

      return ui.stack([
        ui.search({ bind: 'q', placeholder: 'name, prop, or user', count: items.length }),
        body
      ])
    }
  }],


  commands: [{
    id: 'project.reindex',
    label: 'Rebuild project index',
    run: async context => { context.editor.index = await context.files.index(); context.redraw() }
  }]
}
