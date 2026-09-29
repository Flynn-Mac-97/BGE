# Animation and effects

All of it is CSS. The kit adds a lifecycle to hang it on and a set of ready classes.

## Phases

Every panel and anchor element carries `data-phase`: `entering` (its first frame), `open`, then `leaving` after `hide(id)` when it was shown with `leave: seconds`. With no `leave`, `hide` removes at once.

- The kit fades each panel and anchor in and out by default (`--ui-duration`, `--ui-ease`).
- Style a phase from your theme. In a panel, `:host([data-phase="entering"]) .card { transform: translateX(-16px) }` with `.card { transition: transform var(--ui-duration) }` slides it in. An anchor is the element itself: `.ui-anchor[data-phase="entering"]`.
- A leaving record takes no clicks or keys, and `isShowing` is false.
- Never put a `transition` on an anchor's `transform`: the kit moves anchors with it every frame.

## Ready classes

Add as `class`: `ui-fade-in ui-fade-out ui-slide-up ui-slide-down ui-slide-left ui-slide-right ui-pop` (play once), `ui-shake` (once), `ui-pulse ui-glow-pulse ui-float ui-spin ui-shine` (loop), `ui-glow ui-blur ui-grayscale` (static).

- `style: '--i:2'` delays an entrance by 2 x 60 ms, to stagger a row.
- `prefers-reduced-motion` shortens every animation and transition to nothing.

## Replaying an animation

An animation plays when its element appears, not when a class stays. Give the element a `key` (any component takes it): `button('Hit', { class: 'ui-shake', key: hits })`. A changed key is a new element, so the animation plays again.

## Your own

Write `@keyframes` and rules in `theme.css` like any page. Custom properties (`--ui-*`), `filter`, `backdrop-filter`, `mask`, `clip-path` and `@property` all work: it is a real browser page.

## Screen effects

`gameUi.effect(name, { life, color, strength, class })` puts a full-viewport layer over the game and under your panels. Answers an id.

- Presets: `flash` (fades out over `life`), `vignette` (add `class: 'ui-pulse'` to throb), `fade` (to `color`, holds), `letterbox` (`strength` is the bar height, 0.12 = 12%), `blur` (behind, `strength` 0 to 1), `scanlines`, `tint`.
- `color` is `danger good accent ink scrim` or a plain CSS colour; `strength` is 0 to 1.
- With `life` it removes itself after that many seconds of game time. Without, it stays: `gameUi.clearEffect(idOrName, { leave })` fades it out over `leave` (default 0.4) and removes it.
- Your own: `gameUi.effect('rain')` uses the class `ui-fx-rain`, so write `.ui-fx-rain { background: ... }` in `theme.css`. `--color`, `--strength` and `--life` are set on it. The name is letters, digits and dashes.
- `gameUi.effects()` lists what runs, for tests. A world shake is the Camera's (`context.camera.shake`); shake a UI element with `ui-shake`.
