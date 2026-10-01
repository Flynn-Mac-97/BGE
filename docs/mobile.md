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

On the real iPad, test a joystick plus a second-finger action, release outside a control, rotate the device, background and restore Safari, and hide the controls while holding them. Test tap/swipe, screen-edge safe areas, audio after the start tap, Home Screen launch and an offline relaunch. Browser automation checks behavior, but cannot certify Safari performance or system gestures.
