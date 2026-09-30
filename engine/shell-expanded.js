/**
 * Kernel: one `expandable` panel drawn over the docks and viewport.
 *
 * A panel declares `expandable: true` and its header gains an Expand button.
 * While expanded it is drawn into the layer `host` instead of its dock, its
 * render gets `isExpanded`, and Esc from inside the layer docks it again. The
 * layer listens, not the window, so Esc means nothing anywhere else.
 */

/**
 * @param {object} parts `host` (the layer element), `frame` (the `.app`
 *   element), `panels()` (every contributed panel), `drawPanel(panel)` and
 *   `paint()` (redraw every dock at once).
 * @returns {object} `id()`, `expand(id)`, `button(panel)` and `draw()`.
 */
export function makeExpandedPanel({ host, frame, panels, drawPanel, paint }) {
  let expandedId = null

  /** Expand the `expandable` panel with this id, or none with null. Answers the id now expanded, or null. */
  function expand(id) {
    const panel = panels().find(candidate => candidate.id === id && candidate.expandable)
    expandedId = panel ? panel.id : null
    paint()
    host.querySelector('.panel-act')?.focus()
    return expandedId
  }

  host.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    expand(null)
  })

  return {
    id: () => expandedId,
    expand,

    /** The header button that expands a panel, or docks it again. */
    button(panel) {
      const isExpanded = panel.id === expandedId
      const button = document.createElement('button')
      button.className = 'panel-act'
      button.textContent = isExpanded ? 'Dock ⤡' : 'Expand ⤢'
      button.title = isExpanded ? 'Put the panel back in its dock (Esc)' : 'Show the panel over the whole editor'
      button.setAttribute('aria-pressed', String(isExpanded))
      button.onclick = () => expand(isExpanded ? null : panel.id)
      return button
    },

    /** Fill the layer with the expanded panel, or hide it. */
    draw() {
      const panel = panels().find(candidate => candidate.id === expandedId)
      host.innerHTML = ''
      host.classList.toggle('hidden', !panel)
      frame.classList.toggle('has-expanded', Boolean(panel))
      if (!panel) return
      host.setAttribute('role', 'dialog')
      host.setAttribute('aria-label', panel.title)
      host.append(drawPanel(panel))
    }
  }
}
