# Mobile game controls

Use Keyboard Input and Game UI. Mobile controls belong to a game panel. Keep overlays non-interactive except their controls.

```js
const kit = context.gameUi.kit
context.gameUi.show('controls', {
  html: kit.mobileControls([
    kit.joystick(),
    kit.actionButton('Fire', { action: 'fire' })
  ])
})
```

`joystick({ left, right, up, down, deadZone, label, isDisabled })` maps an eight-way stick to named actions. The defaults are the four direction actions and a 0.2 dead zone. Read `input.axis('x')` and `input.axis('y')`; up is positive. Uses digital directions. Set all four names for alternate bindings.

`actionButton(label, { action, isDisabled })` holds a named game action for as long as its pointer is down. A second finger can use it while the stick moves. Mobile holds use separate recorded codes, so lifting a finger does not release a keyboard key or another control. `input.holdAction(action, source)` and `input.releaseAction(action, source)` provide the same route without a browser. Keep source names stable and bounded, one per control.

`gestureArea(children, { action, label, debug })` reports through the panel's `on` table on a fixed step. Set `debug: true` for persistent touch trails, finger markers and gesture labels. Up to two contacts belong to each area.

- `tap`: within 12 pixels and 350 ms. Client x/y coordinates. The first tap is immediate; a second nearby tap within 300 ms reports `doubletap`.
- `longpress`: stationary within 8 pixels for 500 ms; does not also tap.
- `dragstart`, `drag`, `dragend`: movement beyond 8 pixels, with x/y displacement.
- `swipe`: at least 40 pixels within 700 ms, with direction, x/y displacement, distance and duration. A fast drag also reports a swipe at release.
- `transformstart`, `transform`, `transformend`: two-finger pinch, rotation and pan together, with scale, rotation in degrees and midpoint x/y displacement from the starting pair. No single-finger tap fires after a transform.
- `cancel`: interrupted contact; does not report a tap or swipe.

Use `gameUi.click(id, action, value, 'swipe')` in a headless test.

Pointer capture keeps a hold alive outside its original hit area. Pointer cancellation, lost capture, hidden pages, window blur, panel removal, disabled controls and level changes release held inputs. Hiding a panel releases immediately, including one with a leave animation.

Style `.ui-mobile-controls`, `.ui-joystick`, `.ui-joystick-thumb`, `.ui-action-button` and `.ui-gesture-area` in the game's theme. Control targets are at least 44 CSS pixels; the default action button is 64. The layout respects safe-area insets. Touch-action suppression applies only to these controls. The stick still uses digital directions.

An HTML refresh restores each active control's held appearance after patching the DOM. Keep pointer feedback immediate; do not animate the joystick thumb toward the finger. For earlier engagement in a game, lower the joystick's `deadZone` rather than changing the input clock.
