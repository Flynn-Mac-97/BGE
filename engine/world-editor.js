/**
 * Kernel: the editor's own state, and the two commands on it.
 *
 * Built here rather than in `start-world.js`: the editor outlives every level,
 * and the surface the rest of the boot offers reads its selection and its tool.
 */

/**
 * The editor's state for one open project.
 *
 * @param {object} options
 * @param {string} options.projectDirectory The name a project file is known by.
 * @param {string} options.projectName What the editor shows.
 * @param {boolean} options.projectUntitled Whether the project is the scratch one.
 * @param {object} options.bus The bus a selection or tool change is announced on.
 * @returns {object} The editor: its names, level, selection, tool, index and
 *   camera, and `select` and `setTool`.
 */
export function makeEditor({ projectDirectory, projectName, projectUntitled, bus }) {
  const editor = {
    // The name a file is known by, and the name a person is shown. Two
    // different questions — a panel showing the title and a plugin naming
    // `project/plugins` need different answers.
    projectDirectory,
    projectName,
    projectUntitled,
    levelName: '—',
    selection: new Set(),
    tool: 'select',
    index: { types: {}, behaviours: {}, levels: {}, assets: {}, config: [] },
    camera: null,
    context: null,

    /**
     * Replace or extend the selection with the given ids.
     *
     * @param {string|string[]|object|object[]} ids One id, or a list of ids or
     *   objects with an `id`. Falsy entries are dropped.
     * @param {boolean} [additive] Keep the current selection instead of
     *   replacing it.
     * @returns {void}
     */
    select(ids, additive = false) {
      const list = []
        .concat(ids ?? [])
        .map(v => (typeof v === 'string' ? v : v?.id))
        .filter(Boolean)
      if (!additive) editor.selection.clear()
      for (const id of list) editor.selection.add(id)
      bus.emit('selection:changed', [...editor.selection])
    },

    /**
     * Set the active editor tool and announce the change.
     *
     * @param {string} id The tool id.
     * @returns {void}
     */
    setTool(id) {
      editor.tool = id
      bus.emit('tool:changed', id)
      bus.emit('plugins:changed')
    }
  }

  return editor
}
