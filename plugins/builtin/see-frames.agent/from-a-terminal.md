# A frame from a terminal, with no tab of your own

`see.capture` and `see.moment` draw through a browser. `lanes.start` gives you
a headless one, so an agent that must not touch the person's tab still gets a
real rendered frame. Four commands, in this order:

```sh
ENGINE_PORT=5187 npx vite --port 5187 &          # 1. a dev server for THIS checkout
node bin/engine.mjs --port 5187 lanes.start sight # 2. a headless browser on it
node bin/engine.mjs --port 5187 run see.capture '{"ui":false}' --client sight
node bin/engine.mjs lanes.stop sight              # 4. always, before you finish
```

- **A worktree needs its own server and its own port.** The default port serves
  the main checkout; a lane started against it renders another workspace's code.
  `run` refuses that rather than answer from the wrong tree, and the refusal
  names the fix.
- **`--port` goes on every call after step 1**, including `lanes.start`. Without
  it the CLI reaches the default port.
- In the main workspace with a server already running, skip step 1 and the
  `--port` flag.
- A lane browser is started at device pixel ratio 1, so its PNG is exactly the
  declared profile.
- `lanes` lists every lane browser, each proved against its debugging port. One
  left running holds the work lock.

## In a container, running as root

A cloud session or a Codespace needs nothing installed for the four commands
above. Chrome has to start without its sandbox as root, and the engine passes
`--no-sandbox` for that user alone. It finds a Chromium in the Playwright cache
(`PLAYWRIGHT_BROWSERS_PATH`) when there is no `CHROME_PATH` and no
`.browsers`, so the supervisor needs no environment of its own either.

- **A lane page is a viewer.** It never writes the checkout, and `project.open`
  and `project.saveAs` from it are refused. The project is chosen when the dev
  server starts: `ENGINE_PROJECT=<absolute path> ENGINE_PORT=5187 npx vite
  --port 5187`. A relative path is taken from the current directory, and the
  server creates an empty project there.
- **The editor takes about 20 seconds to boot.** `see.describe` answering "did
  not answer in 8000 ms" right after `lanes.start` means wait, then ask again.
- **A level with no entities captures as blank.** The canvas is transparent, so
  "the canvas read back empty" on an empty level is the true answer.
- **`supervisor.open editor-browser` needs a display.** There is none in a
  container, so use a lane.
