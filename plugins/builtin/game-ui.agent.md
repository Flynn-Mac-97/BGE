---
description: HTML and CSS a game shows over its picture — menus, inventories, settings, and nameplates that follow entities — with a component kit and one theme file. Use for anything easier to lay out as a page than as Screen's canvas items.
triggers: game ui, ui kit, html ui, css ui, theme.css, inventory screen, settings menu, nameplate, world space ui, health bar over enemy, character sheet, shop screen, gameui.read, gameui.click, context.gameUi
category: presentation
---
# Game UI

```js
const { stack, heading, button } = context.gameUi.kit
context.gameUi.show('shop', { isInteractive: true,
  html: () => stack([heading('Shop'), button('Buy', { action: 'buy', kind: 'primary' })]),
  on: { buy: () => { gold -= 10 } } })
context.gameUi.anchor('tag:7', { to: 'enemy7', offset: [0, 2, 0], html: enemy => `<b>${enemy.name}</b>` })
```

- `show(id, { html, css, on, isInteractive, takesKeys, every })` is a panel: it fills the viewport and lets clicks through unless `isInteractive`, and only while it has content (`takesKeys` takes the menu keys only). `anchor(id, { to, offset, html, on })` is a box that follows a world point. `hide(id)` takes either down (after `leave` seconds if set). Both clear on `level:loaded` and `play:stopped`.
- `html` is a string or a function asked each drawn frame (each `every`-th with `every: n`). The DOM is patched only when the string changes, so focus and slider drags survive.
- **One stylesheet:** `assets/ui/theme.css`, plain CSS for every panel and anchor. Its `--ui-*` tokens also colour Screen and the HUD. Every kit component takes `class` and `style`. `gameUi.theme.use(css)` / `.load('ui/other.css')` swaps it live.
- **Events are the game's:** a control names its `action`; `on` maps `action` or `action:type` to `(value, event) => {}`. The handler runs on the next fixed step, so replays repeat it. `kit.target(children, { action, triggers })` makes any element raise your event.
- **Keys:** the last interactive or `takesKeys` panel takes `uiUp uiDown uiLeft uiRight uiConfirm uiBack` (bind them with `input.bind`).
- **Headless:** `gameui.read`, `gameui.controls '"id"'`, `gameui.click '{"id":"shop","action":"buy"}'`, `gameui.list`, `gameui.theme`. A test checks a panel with these and no browser.
- `data-ui="name"` on an element reports the pointer: `hovered(id)`. `gameUi.asset('ui/a.png')` is an image URL under `assets/`.
- Mounts into the kernel's `overlay` region. Screen draws a canvas under it; use Screen for title, pause and result cards.

## Detail

- `game-ui.agent/components.md` — every kit function and its options
- `game-ui.agent/theme.md` — tokens, styling hooks, writing theme.css
- `game-ui.agent/world-space.md` — anchors, culling, limits, cost
- `game-ui.agent/events.md` — actions, triggers, typed handlers, focus
- `game-ui.agent/motion.md` — phases, `leave`, effect classes, replaying
- `game-ui.agent/coverage.md` — what a game's UI needs, and what is done
