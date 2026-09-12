---
description: Connects the terminal to one live editor tab so CLI verbs read and drive the page. Use when a command answers 'no editor attached', when two tabs fight over the bridge, or when checking live state and drawing rather than a headless world.
---

# Terminal Bridge

- Opens the editor's `window.engine` surface to anything outside the browser,
  so a terminal reads and drives a live page without a screenshot.
- Transport is Vite's own dev-server websocket. No extra port, no extra
  dependency, and it dies with the dev server.

```
terminal  ->  bin/engine.mjs  ->  POST /api/engine  ->  ws  ->  here
```

- **An op is a method name on `window.engine`.** This file never changes when a
  verb is added; the surface and the bridge stay in step by construction.
- An op that is not a method is tried as a **command id**, so a plugin that
  registers `tests.run` has added a terminal verb and `bin/engine.mjs` never
  heard about it.
- Two ops are its own: `ping` says whether the page has finished booting and
  which level is open, and `eval` runs a string of JavaScript in the page —
  the escape hatch for anything the surface does not cover.
- Emits `bridge:ready` on the bus once the socket is listening.

## What it refuses, and how

- **No dev server, no bridge.** A production build has no `import.meta.hot`, so
  `onLoad` returns and nothing is registered. That is not an error.
- An op called before the editor finishes booting throws `engine not ready
  yet`. Retry rather than treating it as a missing verb.
- An unknown op throws and the message lists every method and every command id,
  so a wrong name answers with the right one.
- Results cross a JSON boundary. A function, a DOM node, a bigint or a circular
  reference is replaced with a label rather than failing the call, so a command
  that returns something unserialisable still reports that it ran.

## When not to use it

Headless is the other half: `--headless` runs a private world in the calling
process with no server, no browser and no port. Many run at once and never see
each other. Use the bridge only when the question is about live editor state or
what is actually drawn.

- `bridge.status` — whether the socket is open, and the transport.
