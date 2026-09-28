/**
 * Kimodo's cut board: a person sees the whole take Kimodo made and chooses
 * which frames the take keeps, where the automatic cut chose badly. The whole
 * take stays stored, so a take can be cut again at any time.
 *
 * A cut is one record, built by `openCut` and changed only by the board:
 *
 *   {
 *     clip: 'motion/kimodo-mannequin/take-walk-a.json',
 *     model: 'models/kimodo-mannequin.glb',
 *     whole,                 every frame, as Rig Animation reads a clip
 *     frames: 90,
 *     isLoop: true,
 *     first: 12, last: 57,   capture frames; `last` is not kept, and a loop goes back to it
 *     note: ''
 *   }
 */
import { widenClip } from '../rig-animation.js'

/** The whole take from `kimodo.full`, as a cut record starting at the take's current cut. */
export function openCut(take, full) {
  return {
    clip: take.clip,
    model: take.model,
    whole: widenClip(full.clip, take.clip),
    frames: full.frames,
    isLoop: full.clip.loop !== false,
    first: full.kept[0],
    last: full.kept[1],
    note: ''
  }
}

/** The kept frames as a clip to watch; a loop is not yet closed here, so its jump back shows as it is. */
export function cutPreview(cut) {
  const kept = list => list.slice(cut.first, cut.last)
  const positions = cut.whole.positions
  return widenClip(
    {
      ...cut.whole,
      rotations: kept(cut.whole.rotations),
      positions: positions && Object.fromEntries(Object.entries(positions).map(([node, frames]) => [node, kept(frames)])),
      root: cut.whole.root && kept(cut.whole.root)
    },
    cut.clip
  )
}

/** The highest frame `last` can be: a loop reads frame `last` to close onto; a take that plays once does not. */
const lastFrameOf = cut => (cut.isLoop ? cut.frames - 1 : cut.frames)

/** What the kept frames are, in words. */
const keptText = cut =>
  `Keeps frames ${cut.first}–${cut.last - 1} of ${cut.frames}: ${cut.last - cut.first} frames, ${((cut.last - cut.first) / 30).toFixed(2)} s.`

/**
 * The side column while cutting. `actions` is `{ showFrame(frame), showWhole(),
 * showCut(), save(), close() }`. A slider shows the frame it is dragged to,
 * so a person sees the pose the cut starts or ends on.
 */
export function cutRows(ui, cut, actions) {
  const summary = ui.text(keptText(cut))
  const slider = (key, value, min, max, set) => {
    const element = ui.slider({
      k: key,
      min,
      max,
      step: 1,
      value,
      onChange: frame => {
        const chosen = set(frame)
        element.lastChild.textContent = String(chosen)
        summary.textContent = keptText(cut)
        actions.showFrame(Math.min(chosen, cut.frames - 1))
      }
    })
    return element
  }
  return [
    ui.text(cut.clip.split('/').pop().replace(/\.json$/, '')),
    summary,
    slider('in', cut.first, 0, lastFrameOf(cut) - 2, frame => (cut.first = Math.min(frame, cut.last - 2))),
    slider('out', cut.last, 2, lastFrameOf(cut), frame => (cut.last = Math.max(frame, cut.first + 2))),
    ui.text(
      cut.isLoop
        ? 'Out is the pose the loop goes back to: choose a pose like the one at in. Save smooths the join.'
        : 'Out is the first frame the take does not keep.',
      { dim: true }
    ),
    ui.row([
      ui.button('Play whole', actions.showWhole, { small: true }),
      ui.button('Play cut', actions.showCut, { small: true })
    ]),
    ui.row([ui.button('Save cut', actions.save, { primary: true }), ui.button('Close', actions.close)]),
    ...(cut.note ? [ui.text(cut.note, { dim: true })] : [])
  ]
}
