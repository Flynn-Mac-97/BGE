/**
 * Kernel: which panels are folded to their header.
 *
 * `shell.js` draws the panels; whether one is folded is a separate concern. A
 * panel starts folded when its plugin sets `collapsed: true`, and a person's
 * choice overrides that. Only the choices are stored, so a plugin that changes
 * its default reaches every person who never touched the panel. Like the dock
 * sizes, they are browser-local state and never enter project files.
 */

const FOLDS_KEY = 'browser-game-engine.folds.v1'

/** The stored choices, or none when storage is blocked or holds something else. */
function readChoices() {
  try {
    const stored = JSON.parse(localStorage.getItem(FOLDS_KEY) || '{}')
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
  } catch {
    return {}
  }
}

/** Store the choices for the next page. Blocked storage is not an error. */
function saveChoices(choices) {
  try {
    localStorage.setItem(FOLDS_KEY, JSON.stringify(choices))
  } catch {
    /* storage may be blocked */
  }
}

/**
 * The fold state of every panel.
 *
 * A panel is a contributed record with an `id` and an optional `collapsed`.
 * A choice is the string `'folded'` or `'open'`.
 */
export function makeFolds() {
  let choices = readChoices()

  /** Whether a panel shows only its header right now. */
  function isFolded(panel) {
    return (choices[panel.id] ?? (panel.collapsed === true ? 'folded' : 'open')) === 'folded'
  }

  /** Store one choice for one panel and return whether it is folded. */
  function choose(panel, choice) {
    choices = { ...choices, [panel.id]: choice }
    saveChoices(choices)
    return isFolded(panel)
  }

  return {
    isFolded,
    fold: panel => choose(panel, 'folded'),
    open: panel => choose(panel, 'open'),
    /** Flip one panel from what it shows now. */
    toggle: panel => choose(panel, isFolded(panel) ? 'open' : 'folded'),
    /** Forget every choice, so each panel returns to what its plugin asked for. */
    reset() {
      choices = {}
      saveChoices(choices)
    }
  }
}
