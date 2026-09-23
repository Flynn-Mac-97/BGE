/**
 * Kernel: carry the world through a page reload, and say so either way.
 *
 * Editing anything under `engine/` or `plugins/` is a full page reload — Vite's
 * answer for source that cannot swap in place, and the right answer for the
 * editor itself. What is wrong is that the reload is silent. The page comes
 * back with a world rebuilt from the level file, so a simulated moment is gone,
 * and the next frame an agent takes shows a different world with nothing
 * anywhere saying why. The frame looks wrong, and the wrong thing gets debugged.
 *
 * Two promises are made here, and the second one holds even when the first
 * cannot:
 *
 *   the moment survives   what makes the moment — the level, every entity with
 *                         where it is and what it holds, shared game state, the
 *                         camera, the selection, whether play was running — is
 *                         written to sessionStorage before the page goes and put
 *                         back after it boots. `reload-projection.js` writes it
 *                         down and puts it back.
 *   the reload is said    the first `snapshot()` or `run()` after the page comes
 *                         back carries a plain sentence naming the file that
 *                         triggered it, when, and exactly what did and did not
 *                         come back. It is said once and then stops, so it
 *                         cannot haunt every later reply. `reload-notice-writer.js`
 *                         writes the sentence and offers it.
 *
 * This file is the seam: it re-exports both halves, so a caller or a test imports
 * one path and nothing else has to know the split.
 */
export { captureSessionWorld, restoreSessionWorld } from './reload-projection.js'
export { describeReload, takeReloadNote, lastReloadNotice, carryWorldThroughReload } from './reload-notice-writer.js'
