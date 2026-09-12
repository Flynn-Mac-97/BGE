# The shape a frame comes out at

A game declares the screen it is drawn for once, as `device` in `game.json`:
`{ "device": { "width": 540, "height": 960, "pixelRatio": 2, "orientation":
"portrait" } }`. `see.capture` draws at that shape with nothing asked for, so
every frame of one game is the same shape and a set can be compared. A game that
declares no device gets the window. `size` overrides both for one call.

Every capture reply and sidecar carries `profile`: `width`, `height`,
`orientation`, `from` (`game.json device` | `the size given` | `the window`),
`frame` — the PNG's own pixels — and the measured `pixelRatio`. Check a frame's
shape against `profile`, not against a reply nobody kept. A studio crop is
smaller than the screen it was drawn on, so it reports `cropped: true` instead
of a ratio.

The PNG is the profile multiplied by the page's device pixel ratio. A lane
browser is started at ratio 1, so a lane's frame is exactly the profile; a
HiDPI tab writes the same profile at twice the pixels. `profile.frame` and
`profile.pixelRatio` say which you have, so compare frames on `profile`, never
on file dimensions.

The HUD is laid out for the WINDOW. Whenever the frame shape differs from the
window's it is left out and the reply's `interface` field says so; `{"ui":true}`
puts it in, stretched. A declared portrait profile on a landscape editor window
therefore captures the world alone by default.

A generated frame name carries the page's client name — `meadow-alpha-1.png`,
`meadow-bravo-1.png` — so two lanes capturing at once never write one path, and
the counter steps past frames already on disk. A path given as `name` or `file`
is yours to reuse; the reply carries `replaced: <path>` when it overwrote one.

`see.capture` needs the dev server and a page on it — your own tab, or a lane
browser (see "A frame from a terminal"). Under `--headless` there is no renderer
and the refusal names `see.sketch`, which takes the same options.

The tab must be in front. A hidden tab runs no frames, so the HUD and screen
layers hold whatever was painted last while the world is drawn fresh — capture
refuses rather than hand back half a stale picture. `{"ui":false}` captures the
world alone and works in any tab.

Marks are HULLS: each marked entity is outlined in its TYPE's colour, drawn
on its own pixels — one colour per type, so a busy frame is a handful of
colours. The reply and sidecar both carry `palette` (type → hex), `marks`
(number → id) and each marked entry's `hull` (its screen outline as [x, y]
percent points). In a capture the hull traces the entity's drawn silhouette
from the ID buffer; in a sketch or bare describe it is the projected box.
The subject is white and wider — except in an `alone` studio frame, which is
unmarked on purpose. `palette` names OUTLINE colours and never a thing's own
material colour: a rat outlined in `#e06c72` is not a pink rat.

Which entities get marked: marks are dealt out by type, not by size. Every
type on screen takes its first mark before any type takes a second, rarest
first, so `palette` names every kind in frame. After that a type's turn comes
round in proportion to how much of it the camera holds — a sea of props is
sampled once or twice and the creatures take the rest. In a subject shot the
subject is always mark 1. Anything wider or taller than half the frame is a
backdrop and is never marked.

**Marks help you find a thing, and they make a frame score better than it
is.** An outline drawn on a picture measurably inflates a vision model's
judgement of it, and saying so in the prompt does not undo it. So a frame is
either for identification or for judgement, never both: keep the marks when
the question is which thing is which, and ask for a clean frame when the
question is whether the art is any good. An `alone` studio frame is already
unmarked and ships no `palette`, because judging the model is the only thing
it is for.
