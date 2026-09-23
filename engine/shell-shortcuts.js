/**
 * Kernel: the shortcut table, and the one keyboard listener.
 *
 * A shortcut is a claim on a key that every other plugin shares, so only the
 * place that can see every contribution at once can honour it and say when two
 * of them want the same key. `shell.js` builds the frame; matching a key and
 * reporting a collision live here.
 */

const MODIFIERS = ['ctrl', 'shift', 'alt']

/**
 * A key event in the contract's spelling: ctrl, shift, alt, then the key,
 * lowercased and joined by '+'.
 *
 * Meta counts as ctrl, so one declaration covers Windows and macOS. A plugin
 * should not have to know which machine it is running on, and a plugin that
 * tried would get it wrong on the other one.
 */
export function shortcutFromEvent(event) {
  const parts = []
  if (event.ctrlKey || event.metaKey) parts.push('ctrl')
  if (event.shiftKey) parts.push('shift')
  if (event.altKey) parts.push('alt')
  parts.push(String(event.key ?? '').toLowerCase())
  return parts.join('+')
}

/**
 * A declared shortcut in that same spelling, or null when it is not one.
 *
 * Modifiers are put back into the contract's order rather than refused out of
 * it: 'shift+ctrl+z' means exactly what 'ctrl+shift+z' means. A part that is not
 * a modifier at all is a different matter — 'meta+z' would otherwise quietly
 * bind the bare letter z, and the author would never learn why.
 */
export function readShortcut(declaration) {
  if (typeof declaration !== 'string' || declaration === '') return null
  const parts = declaration.toLowerCase().split('+')
  const key = parts.pop()
  if (!key) return null
  if (parts.some(part => !MODIFIERS.includes(part))) return null
  // ' ' is what the space bar reports and 'space' is what an author writes.
  // Both mean the space bar, and a declaration that reads well but never fires
  // is found by pressing it and getting nothing.
  return [...MODIFIERS.filter(m => parts.includes(m)), key === 'space' ? ' ' : key].join('+')
}

/** The input types that swallow a character, so a shortcut must stay out of them. */
const TEXT_INPUT = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'number',
  'date',
  'time',
  'datetime-local',
  'month',
  'week'
])

/**
 * Is this element taking text, so a shortcut must stay out of it?
 *
 * A shortcut must neither fire into a field nor be swallowed on the way there:
 * Ctrl+Z in a text box is the text box's undo. Both hand-rolled guards in the
 * built-ins test the same two tags; a contentEditable element is the same
 * mistake under another name.
 *
 * Not every `input` is typing. `ui.slider` builds `input type="range"`, and it
 * keeps focus after a drag — a tag-name test therefore turned every shortcut
 * off for as long as someone had touched a slider, silently. Only the types
 * that swallow a character count.
 */
export const typingIn = element =>
  element?.tagName === 'TEXTAREA' ||
  element?.isContentEditable === true ||
  (element?.tagName === 'INPUT' && TEXT_INPUT.has((element.type || 'text').toLowerCase()))

/**
 * The lookup a key press is matched against, plus a named report for every
 * declaration that could not go into it.
 *
 * The first declaration keeps a contested key, because a working shortcut that
 * stopped working is worse than a new one that never started. What is not
 * allowed is choosing quietly: two plugins claiming Ctrl+Z is a real mistake,
 * and it is invisible from inside either of them.
 */
export function collectShortcuts(declarations, report = () => {}) {
  const table = new Map()
  for (const entry of declarations) {
    const shortcut = readShortcut(entry.key)
    if (!shortcut) {
      report(
        `${entry.what} "${entry.name}" (${entry.plugin}) declares key ${JSON.stringify(entry.key)}` +
          ' — a shortcut is ctrl, shift and alt in that order, then the key, so nothing was bound'
      )
      continue
    }
    const taken = table.get(shortcut)
    if (taken) {
      report(
        `"${shortcut}" is claimed twice: ${taken.what} "${taken.name}" (${taken.plugin}) keeps it,` +
          ` ${entry.what} "${entry.name}" (${entry.plugin}) will never fire — one of the two has to change`
      )
      continue
    }
    table.set(shortcut, entry)
  }
  return table
}

/**
 * Build the shortcut table from the current contributions and return the
 * handler for the one keyboard listener.
 *
 * A command is dispatched through `context.run`, the path a button and the CLI
 * already take, so anything that path does keeps happening for a key press too.
 * A tool is switched the way its rail button switches it — `key` was already
 * declared on a tool and already shown in its tooltip, so the only missing part
 * was the one that made the tooltip true.
 */
export function makeShortcuts(context, draw) {
  const { loader, bus, editor } = context

  const declaredShortcuts = () =>
    [
      ...loader.contrib.commands.map(command => ({
        key: command.key,
        what: 'command',
        name: command.id,
        plugin: command.plugin,
        run: () => context.run(command.id)
      })),
      ...loader.contrib.tools.map(tool => ({
        key: tool.key,
        what: 'tool',
        name: tool.id,
        plugin: tool.plugin,
        run: () => editor.setTool(tool.id)
      }))
    ].filter(entry => entry.key != null)

  // Said once each. Contributions are rebuilt whenever a plugin is enabled or
  // the tool changes, and the same collision repeated on every rebuild would
  // bury the rest of the log.
  //
  // Held until `shell:ready`, because the shell is built inside startWorld
  // before makeInspect installs the capture that puts a console.error into the
  // engine log. Collisions are declared at plugin load, so they all happen in
  // exactly that window — reporting them eagerly meant the normal case was
  // announced to a log nobody was keeping, and the dedupe then guaranteed it
  // was never said again. Silence is the enemy, and this was the silence.
  const saidAlready = new Set()
  let pending = []
  const say = message => console.error('[shortcut]', message)
  const reportShortcut = message => {
    if (saidAlready.has(message)) return
    saidAlready.add(message)
    if (pending) pending.push(message)
    else say(message)
  }
  bus.on('shell:ready', () => {
    const held = pending || []
    pending = null
    for (const message of held) say(message)
  })

  let shortcuts = new Map()
  /** Rebuild the key table from the current contributions, reporting each collision once. */
  const gatherShortcuts = () => {
    shortcuts = collectShortcuts(declaredShortcuts(), reportShortcut)
  }
  gatherShortcuts()
  bus.on('plugins:changed', gatherShortcuts)

  /**
   * The one keydown listener in the engine.
   *
   * Three built-ins each opened their own, and a plugin's listener cannot see
   * that another plugin already took the key, nor share the guard that keeps a
   * shortcut out of a text field. A command declares; the kernel listens.
   */
  function handleKey(event) {
    // Held keys repeat at the operating system's rate. Without this, holding a
    // key bound to a command that saves runs sixty whole-level writes a second,
    // all racing each other.
    if (event.repeat) return
    // Something nearer the key already answered it. Every focusable widget in
    // `ui.*` — a list row, a tree row, a grid cell — is a role=button that
    // handles Enter and Space and calls preventDefault without stopping the
    // bubble, so without this a global `space` binding fires as well as the
    // row the person actually pressed.
    if (event.defaultPrevented) return
    if (typingIn(event.target)) return
    // The editor's shortcuts are the editor's. While the game runs it owns the
    // keyboard, and a stray `v` must reach the game rather than switch the tool
    // behind it.
    if (context.loop?.running) return
    const wanted = shortcuts.get(shortcutFromEvent(event))
    if (!wanted) return
    // Only once something has actually claimed the key. Swallowing every
    // keystroke would take Ctrl+Z away from the browser and from anything this
    // guard does not cover.
    event.preventDefault()
    // A command may be async — `context.save` is — so a rejected promise has to
    // be caught as well as a thrown error, or the failure this reports is only
    // ever the synchronous half. Redraw after it settles, not before, or the
    // repaint shows the world as it was.
    let running
    try {
      running = wanted.run()
    } catch (error) {
      console.error(`[shortcut] ${wanted.what} "${wanted.name}" failed`, error)
      draw()
      return
    }
    Promise.resolve(running)
      .catch(error => console.error(`[shortcut] ${wanted.what} "${wanted.name}" failed`, error))
      .finally(draw)
  }

  return {
    handleKey,
    // What is bound right now, so an agent can ask which keys are taken instead
    // of pressing them to find out.
    list: () => [...shortcuts].map(([key, entry]) => ({ key, kind: entry.what, id: entry.name, plugin: entry.plugin }))
  }
}
