/**
 * The plugin is imported for its live surface, not for a copy of it.
 *
 * A test is handed a `test` object and no context, and every decision Play Focus
 * makes is made against `context.shell`. Reaching the real context through the
 * module is the point: a test with its own idea of the state would pass while
 * the state the editor actually uses was wrong.
 *
 * Everything below asserts on state — which panels are contributed, what the
 * shell says it is, what the command answers — because the tests run where there
 * is no screen at all. What can only be judged in a browser is noted rather than
 * pretended at: whether the collapsed frame *looks* like the game filling the
 * screen, whether the browser grants real full screen from the play button's
 * gesture, whether the HUD, radar and buy menu redraw at the new size, and
 * whether Escape hands the mouse back before it leaves full screen.
 */
import { playFocus, applyFocus, describeFocus } from '../../plugins/builtin/play-focus.js'

export default {
  name: 'play focus collapses the frame, puts back the same panels, and says why when it cannot',
  level: 'level1',

  run(test) {
    const context = playFocus.context
    if (!test.ok(context, 'Play Focus loaded and published the context it decides against')) return

    // The panel *set*, not the pixels. Focus must hide, never destroy — a dock
    // that is rebuilt loses its scroll position and whatever its panel was
    // holding, and the point of stopping play is getting back what you had.
    const panels = () => context.loader.contrib.panels.map(p => p.id).sort().join(', ')
    const before = panels()
    test.ok(before.length > 0, 'there are panels contributed to begin with, so "the same set" means something')

    const realShell = context.shell

    // ------------------------------------------------ the policy, on a stand-in
    // A stand-in frame rather than the real one, so running this test in an open
    // editor tab does not collapse the editor around the person watching it, and
    // so the same assertions run with no document at all.
    const told = []
    const standIn = {
      focused: false,
      focus(on) { standIn.focused = !!on; told.push(!!on); return standIn.focused },
      draw() {}
    }

    context.shell = standIn
    try {
      test.is(describeFocus(context).focused, false, 'nothing is collapsed to begin with')

      applyFocus(context, true)
      test.is(standIn.focused, true, 'asking for focus collapses the frame')
      test.is(describeFocus(context).focused, true, 'and the report agrees')
      test.is(describeFocus(context).wanted, true, 'and records that focus was asked for')

      applyFocus(context, false)
      test.is(standIn.focused, false, 'letting it go puts the frame back')
      test.is(told, [true, false], 'the frame was told twice and rebuilt never')
      test.is(panels(), before, 'the same panels are contributed after as before — nothing was destroyed')

      // ------------------------------------------------------------- by command
      const on = context.run('play.focus', true)
      test.is(on.focused, true, 'the command turns it on by hand, for testing without playing')
      const off = context.run('play.focus', false)
      test.is(off.focused, false, 'and off again')
    } finally {
      context.shell = realShell
    }

    // ------------------------------------------ a world with no shell at all
    // Headless is the case several agents work in at once. It must report, not
    // throw, and it must say which of the two things is missing.
    context.shell = undefined
    try {
      const blind = context.run('play.focus', true)
      test.is(blind.focused, false, 'with no shell there is nothing to collapse')
      test.is(blind.screen, false, 'and the report says there is no screen')
      test.ok(/no shell/.test(blind.why || ''), 'and says so in words rather than throwing')
      test.is(blind.fullscreen, false, 'nothing is full screen either')
    } finally {
      context.shell = realShell
      applyFocus(context, false)
    }

    // --------------------------------------------------- the report on its own
    const shown = context.run('play.focus')
    test.is(typeof shown.focused, 'boolean', 'play.focus with no argument answers rather than throwing')
    test.is(typeof shown.fullscreen, 'boolean', 'and says whether the browser gave the whole screen')
    test.is(shown.why, null, 'with nothing asked for there is nothing to complain about')
    test.ok(/Escape/.test(shown.escape), 'and it writes down what Escape means, because pointer lock and full screen both answer to it')
    test.ok(/round carries on/.test(shown.escape), 'which is: the mouse comes back and the round carries on — only STOP stops play')

    // ------------------------------------------------- the kernel primitive
    if (realShell?.focus) {
      try {
        test.is(realShell.focus(true), true, 'the shell itself collapses when asked')
        test.is(realShell.focused, true, 'and says it is collapsed')
        test.is(panels(), before, 'every panel is still contributed while it is collapsed')
        test.is(realShell.focus(false), false, 'and it comes back')
        test.is(realShell.focused, false, 'and says so')
        test.is(panels(), before, 'with exactly the panel set it started with')
      } finally {
        realShell.focus(false)
      }
    } else {
      test.note('no shell in this world, so the frame itself was not exercised — collapsing it, the renderer resizing to match and real full screen can only be judged in a browser')
    }
  }
}
