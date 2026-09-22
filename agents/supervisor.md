# Supervisor

- Start the desktop with `npm run electron`, or double-click its packaged
  executable. It owns the supervisor, backend, game views, and terminal sessions.
- Use `desktop snapshot` for the console state and `desktop <action> [json]`
  for its actions. See `docs/desktop.md` for arguments.
- Register desktop resources with `registerManaged`; keep stop callbacks out
  of public records. Never kill a shared host process to close one view.

- Every engine process goes through the supervisor: the dev server, the editor
  browser, a lane browser and a headless session. No other part of the engine
  spawns one.
- Start it with `node bin/engine.mjs supervisor.start`. It is idempotent and
  prints the port. `engine.cmd` opens the desktop. Use `supervisor --watch`
  for the CLI table.
- Open an instance with `supervisor.open <kind> [json]`. Stop one with
  `supervisor.stop <id>`, every owned one with `supervisor.stop all`, and the
  supervisor itself with `supervisor.stop all --down`.
- A `dev-server` opened with `{"checkout":"<path>"}` serves that directory
  instead of this checkout. The path must be this checkout's main worktree or a
  directory inside it, so a lane in `.agent-worktrees/<id>` gets its own server
  from the supervisor and `supervisor.stop <id>` ends it. The reply's `serves`
  names the directory it took, and a browser opened with `{"url":"<that server's
  url>"}` drives it.
- An `editor-browser` or `lane-browser` opened with no url opens on the one
  running dev server. Several are refused and named with their urls, so the
  caller passes the url of the one wanted. None is refused with the verb that
  starts one: `supervisor.open dev-server`.
- Every `editor-browser` is one tab in the one visible window, and every
  `lane-browser` is one headless browser. Each takes its instance id as its
  bridge name, so the table's `ID` column is what `--client <id>` drives and
  what `clients` lists. Opening again under a name already held brings that tab
  to the front instead of adding a second.
- `supervisor.stop <id>` closes that tab. The window closes with its last tab,
  and stopping a dev server closes every tab it was serving, so nothing is left
  on screen showing a dead engine.
- `supervisor` prints the instance list as JSON. `supervisor --watch` prints the
  same list live, with keys: `d` opens a dev server, `e` opens a visible editor
  tab on the running dev server, `h` opens a headless one, `s` stops one, `a`
  stops all, `q` quits. Under the table it draws the supervisor's event feed —
  the last ten opens, closes and deaths from outside — so what happened is not
  lost when an instance vanishes.
- A record is never evidence. The prover asks each instance's own port, so a
  stale record is dropped rather than reported running. An `editor-browser` is
  proved by its own tab in that port's listing, not by the browser answering, so
  a tab closed by hand leaves the table within one prover round.
- `showing` says whether a browser instance can be seen: `visible`, `hidden`, or
  nothing when no page is attached. It is the page's own report, carried in the
  dev server's reply the prover already reads, so it costs no extra request. A
  debugging port cannot answer this — a covered window, a minimised one and a
  background tab all report their bounds as normal — and neither can it see a
  window the operating system was told to hide. Never ask the operating system
  about a browser: the supervisor holds the pid and the port, and a listing of
  every process on the machine reads windows that are not the engine's.
- A process started without asking — `npm run dev`, a probe tool, another
  engine helper — records itself in the same two registries. The supervisor
  reads them on every proof and adopts what it does not hold, so this table is
  complete without the starter asking first, and `supervisor.stop <id>` ends it.
- Nothing depends on the supervisor to run: a process started while it is down
  still records itself, and the supervisor adopts that record when it starts or
  on its next proof.
