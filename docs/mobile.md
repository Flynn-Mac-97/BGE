# Building and testing mobile demos

Use Keyboard Input for named actions, Game UI for touch controls and menus, and Render for the game picture. The mobile UI guide is `plugins/builtin/game-ui.agent/mobile.md`. No new third-party input library is required.

For a small web export with `plugins.only`, explicitly include `Keyboard Input`, `Game UI`, `Screen`, `Heads Up Display`, and the rendering/game plugins used by the project. The export's current dependency pruning uses service contracts; legacy `needs` dependencies must be named too.

## iPad delivery

Export the project and serve the result from an HTTPS static host:

```sh
node bin/engine.mjs --project /path/to/game export --out /path/to/game-web
```

A ZIP contains that directory's contents. It is a hosting package, not an iOS installer. Safari cannot run the game's JavaScript modules directly from a ZIP in Files. An Android APK does not run on iPad. Native iOS/TestFlight distribution needs a separate Apple build and signing workflow.

To enable Home Screen installation and offline caching, add this to game.json:

```json
{"web":{"installable":true,"shortName":"My Game","icon":"assets/icon.png"}}
```

Use a 512 by 512 PNG for the optional icon. The exporter writes a relative-path manifest and a service worker. It pre-caches the exported files after the first successful online visit. On iPad, open the hosted link in Safari, tap Share, then Add to Home Screen. Reopen from the icon. Offline availability begins after the cache finishes; remote assets and services outside the export are not cached.

New builds have content-versioned caches. Close all windows of an older app before reopening to activate a waiting update. Each app deletes only old caches within its own URL scope. Host each game at its own directory or origin. Large games pre-cache all exported files, so keep demo assets small and allow for browser storage limits.

## Device checks

On the real iPad, test a joystick plus a second-finger action, release outside a control, rotate the device, background and restore Safari, and hide the controls while holding them. Test tap, double tap, hold, drag, swipe and two-finger pinch/rotate/pan. Enable `gestureArea` with `debug: true` to inspect persistent trails, direction, distance and contact markers. Test screen-edge safe areas, audio after the start tap, Home Screen launch and an offline relaunch. Browser automation checks behavior, but cannot certify Safari performance or system gestures.

The exported player applies `device.pixelRatio` to the renderer (clamped by the renderer to 1–2). Set it to 1 for a lightweight mobile demo. A ratio of 2 draws four times as many pixels at the same CSS size. The UI keeps its CSS resolution and touch coordinates when this value changes.


## Responsive phone screens

Set `device.fit` to `"screen"` to fill the exported player's available screen in either orientation. The default `"contain"` keeps the declared aspect ratio. Width and height remain the reference size for editor/headless checks. The renderer resizes with the window; game UI can use grid, flexible dimensions and safe-area insets. Set `android.orientation` to `"unspecified"` to allow device rotation.

Gesture areas accept `feedback: 'pinch' | 'rotate' | 'pan' | 'drag' | 'transform'`. Put a `[data-touch-object]` child in the area. The engine sets its transform directly on pointer events and restores it after UI patches, bypassing the fixed-step wait for visual feedback. Gameplay reports still enter the fixed-step queue. Feedback is relative to the current gesture; pinch preview is clamped to 0.1–8 times. Do not animate this child's transform. Use an outer wrapper for a base transform.

CSS text and SVG debug paths retain device-resolution sharpness independently of the 3D render pixel ratio. Debug trails can be disabled for normal play. The OS, WebView and display determine presentation frequency; immediate feedback does not guarantee 90/120 Hz or remove main-thread stalls.


## Mobile HUD starter

`kit.spellBar(spells, { label: 'Spells', radius: 64 })` builds a persistent wheel for named input actions. Each spell has a label, action, remaining cooldown, total cooldown and optional disabled state. Read `input.pressed(action)` for one cast per press; enforce costs and cooldowns in simulation as well as disabling unavailable buttons. Use four spells at the default radius; increase radius for more entries to keep targets separate.

Compose it with `kit.joystick` (custom direction action names for a second aim stick), `kit.bar` for health/energy, `kit.pips` for charges, and ordinary buttons for pause, heal and reset. Keep gameplay controls captured independently. The mobile-playground UI controls exercise shows only the kit components and touch feedback, using default plugin styling. It has no character, arena, combat simulation or effects. Its portrait layout stacks the central sticks above the right spell wheel; landscape places them side by side. Static example markup is cached until a UI setting changes; do not rebuild an entire panel for animated movement.


## Renderer selection

Exported players read `render.backend` from the packaged game before renderer creation. `webgpu` (also the absent-setting default) prefers WebGPU and lets Three.js fall back to WebGL 2 if initialization is unavailable. `webgl` explicitly selects WebGL 2. Saved editor/backend settings do not override a packaged player's selection, including after an APK update.

The demo performance strip reports the actual initialized backend. `WebGL 2 (fallback)` means its WebGPU preference could not be used on that runtime. The strip measures engine frames and browser refresh callbacks; it does not claim hardware display frequency. WebGPU support must be checked in the phone's Android System WebView, independently of Chrome support.
