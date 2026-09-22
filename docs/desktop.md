# Desktop

`electron/main.mjs` starts one desktop. `electron/desktop.mjs` owns the window,
game views, and application shutdown. The console renderer has a narrow IPC
interface. Game views have no terminal or Node capabilities.

The supervisor has one instance list. Electron views and terminals register
with stop callbacks held outside the public records. Servers and external
browsers retain their existing port checks. The CLI and desktop read the same
list. A desktop can take over a CLI supervisor through `/handoff` without
stopping its children; those children become adopted instances.

The console stays outside game views. Reloading or crashing a game does not
close a terminal. xterm.js draws terminals; node-pty starts the processes.
The Windows build uses the bundled ConPTY DLL. A provider is an installed CLI,
not a second agent implementation. The engine supplies the working directory,
engine address, and target id, and preserves the provider's own prompts.

`engine/server-config.mjs` contains the shared backend handlers.
`vite.config.js` adds development bundling. `engine/desktop-server.mjs` serves
the built editor, project files, watches, and the same HTTP handlers without
Vite. `engine/transport.js` carries the same messages over either socket.

## Commands

Run `npm run desktop:build`, then `npm run electron`.
Run `npm run desktop:package` to write the Windows application under `release/`.
Packaging scratch and downloads stay under `.engine/` in the checkout.

Inside a terminal, `engine <verb>` uses the bundled runtime. Outside the app,
use `node bin/engine.mjs <verb>`. `ENGINE_CLIENT` selects the session's target;
an explicit `--client` overrides it.

`desktop snapshot` returns instances, events, sessions, and provider availability.
`desktop <action> [json]` supports:

- `terminal.start`: `provider` and `cwd`.
- `terminal.read`: `id` and character `offset`; returns bounded output and the next offset.
- `terminal.write`: `id` and `text`.
- `terminal.resize`: `id`, `columns`, and `rows`.
- `terminal.interrupt` and `terminal.stop`: `id`.
- `engine.open`, `engine.reload`, and `engine.activate` (`id`).
- `instance.stop`: `id`; `dev.start`; `project.open`: `path`.

`console.instances` remains an engine command. It reads the host list without
adding another panel to each game view.

## Capture

`node bin/engine.mjs run see.editor` writes the active editor and panels to
`agent-runs/see/editor.png`, with a JSON sidecar naming the view and size.
Pass `'{"scope":"window","name":"desktop"}'` to include desktop tabs and
the console. The OS title bar is excluded. `desktop capture` accepts the same
options plus `client`, and works without the editor bridge. Captures require
the active view and a restored window. The host captures both Electron
surfaces at one pixel per DIP; it never reads another application.

## State and limits

Development state is in `.engine/`. Packaged state is in Electron's user data
directory, with projects under Documents/Engine Projects by default.
`ENGINE_STATE_ROOT` and `ENGINE_PROJECTS_ROOT` can put them on another drive.
Application resources remain separate from writable state.

Output is capped at 1 MiB per session, each transfer at 64 KiB, and terminal
scrollback at 5,000 lines. The UI waits for each terminal write before reading
more output. A slow or hidden terminal reports when older output was dropped.
There are at most 24 retained sessions and 200 activity events. Output is not
written to disk by default. Shell history and provider transcripts follow
those programs' own settings.

The UI reports process state and recent output. It does not infer agent thought,
tool calls, or permission state from terminal text. Worktree and claim commands
remain the way to coordinate simultaneous writers. A generic shell's child
commands are not automatically classified as engine tasks.

Normal quit stops owned sessions. A host crash cannot resume a terminal;
reopen the provider using its own recovery commands. Provider installation,
authentication, and subscriptions remain the user's existing setup.

## Verification

`node bin/engine.mjs check` checks engine contracts.
`npm run test:offline` includes managed-instance and production-backend tests.
`npm run test:desktop` exercises real Electron and PowerShell, the production
bridge, terminal input and resize, provider shims, game reload, and cleanup.
It uses an isolated directory under `.engine/` and writes a result there.
On Windows, process-tree tests need permission to terminate their own children.

`npm test` also runs the existing CLI bridge suite, which needs an editor
serving the `level1` test fixture. It is separate from the desktop smoke test.
