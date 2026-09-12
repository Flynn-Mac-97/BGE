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
