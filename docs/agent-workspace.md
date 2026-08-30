# Agent workspace

> One of the engine design docs — the index is [ARCHITECTURE.md](../ARCHITECTURE.md).

## The instruction tree

Agent instructions follow the same disk-first rule as the game. The generated
root `AGENTS.md` is only a bootstrap. `ENGINE-BASE.md` is the base instructions
every agent reads first — speech, code and comment style at a glance, with
links out to the detailed rules. `agents/manifest.json` owns engine rules,
including the Game lane — how to build a game is engine knowledge, not one
game's. `<project>/agents/manifest.json` adds only what that game overrides, and
may be missing entirely. Parent ids join both manifests into one visible tree.

## Where a workflow insight goes

What a run teaches belongs in the tree, not in the next brief. A brief reaches
one agent once; a node reaches every agent that touches a matching file, for as
long as it is true.

An instruction node that **ranks the options for a job** is the most valuable
shape. `agents/art.md` is the worked example: it says that a character is a
Blender model, that a few solids are `mesh.parts`, that a box is a blockout, and
that going straight to the last row is how a game ends up made of boxes. It came
from a lane that built a cat out of eighteen boxes because nothing told it there
was a better route — and the Blender skill existed the whole time, gated behind
triggers the task never said.

So when a run teaches something:

- A rule that is always true → `agents/core.md`, the one node with `always`.
- A route with choices and costs → an instruction node with `match:` on the files
  it applies to, and `triggers:` on the words a task uses to describe the job.
- A tool with a setup cost → a `skill`, `optional`, so it costs nothing until wanted.
- Something about one plugin → its `.agent.md` sidecar.

Check what a real task pulls before trusting it:
`node bin/engine.mjs agent.context '{"task":"...","files":["..."]}'`. A `triggers`
list is only as good as the words people actually write.

None of it is fixed. A node that describes a route we have since beaten is worse
than no node, so the file says to change it in the same task that beats it.

## Which project

The project directory is a start-up parameter, so a `match:` pattern writes
`project/**` and the resolver rewrites a claimed file's real directory to
`project/` before matching. Without that, a game opened as `kitten-survivors`
matched no project rule and the packet still looked complete.

A `tests:` entry writes `<project>`, replaced with the directory in use, so a
lane is handed the check that proves its own game rather than the default one.

`engine/agent-workspace.js` is the shared resolver. It receives a file reader,
so the Agent Workspace plugin and the offline CLI return the same packet.
`plugins/builtin/agent-workspace.js` contributes the **AGENTS** panel and agent
commands. The panel can add instruction or skill branches. It opens their files
in the Code panel. `project/agents/settings.json` stores optional skill state.
Disabled skills stay out of context packets. Skills use `SKILL.md`.

Plugins use the same progressive rule. A plugin guide is a normal Markdown
sidecar: `physics-3d.js` pairs with `physics-3d.agent.md`. The file is found
without a manifest and appears under the **Plugins** tree branch. Its guide is
included only for an enabled plugin when a task names the plugin or touches its
source file. This keeps a project with many plugins from sending every guide to
every agent.

`Plugin Master` is a builtin plugin. Its sidecar guide declares
`match: plugins/** project/plugins/**`, so the rules for creating and editing a
plugin ride along with any plugin task — and, being a plugin, it can grow
commands and tests like any other.

## Project overrides

Engine instructions may name an `override` key. A project instruction with the
same key replaces that engine instruction for matching project files. This is
for local style and workflow rules, such as code style or comment style. Engine
safety rules do not expose a key and cannot be replaced.

Git stays on the Node side. `engine/agent-workspace-node.mjs` backs
`agent.prepare` and `agent.release`, keeps the run registry in
`project/.engine/agents.json`, rejects overlapping claims, and creates a git
worktree only for a parallel writer. A small single-writer task stays in the
current workspace. The browser can inspect this state but cannot execute git.

This split is deliberate: instruction routing is portable engine behavior;
process and worktree management is CLI behavior.

## Several agents at once

Read this before fanning out. Two of the guarantees this file used to state are
not enforced, and the difference matters.

**One checkout, or a worktree each?** One checkout is safe when lanes own
different files and none of them touch `<project>/`. The index is written
temp-then-rename, so several `check` runs cannot tear it. Use a worktree the
moment a lane writes anything under `<project>/`: `saveLevel` rewrites the whole
level file, so two agents on one level lose a write rather than getting a
conflict.

**What is enforced, and what is not:**

| | state |
|---|---|
| clean tracked baseline before `--parallel` | enforced, `prepare` refuses otherwise |
| index written atomically | enforced |
| stale registry lock | broken after 60s, with a named warning |
| file claims | enforced by `Claim Guard`, which refuses a write to another run's file by name. Node only, and off if the plugin is off |
| `agent.release` | runs each required check in the lane's workspace and refuses to complete when one fails |
| `agent.merge` | merges the lane, runs its deferred checks in main, removes the worktree, deletes the branch |

**Before the first lane, read one packet.**

```sh
node bin/engine.mjs agent.context <project>/plugins/probe.js --project <project>
```

Check the `lanes` list, not just that a packet came back. A thin one means no
rule matched, and it looks exactly like a full one — five lanes once ran on 810
characters with neither Plugin Master nor the Game lane, and nothing errored.

**Give every lane a claim of its own.** A claim promises that two writers never
edit one file, so claim the files a lane will own. A folder claim is for a lane
that owns the folder; it blocks the files already in it, not files nobody has
written yet.

**The recipe:**

```sh
git status --porcelain --untracked-files=all   # must be empty, or prepare refuses
node bin/engine.mjs agent.prepare <id> <file...> --parallel
# the lane works in .agent-worktrees/<id>, with ENGINE_AGENT_ID=<id> set
node bin/engine.mjs agent.release <id>          # runs the checks; refuses if one fails
node bin/engine.mjs agent.merge <id>            # lands it, then removes worktree and branch
```

A proof script in `agent-runs/` must not clean up by resetting the checkout.
Lanes hold worktrees off the same HEAD, so `git reset --hard` in a cleanup
block reaches work the script never made. Export the pure function and point it
at a `mkdtempSync` directory instead.

A worktree isolates **tracked** files only, so commit untracked work first or
lanes fight over exactly the files that are not in it.

**What still bites:**

- Two editor tabs on the SAME server both answer the bridge and the first
  reply wins, so a state-dependent CLI call can read the other tab's world.
  One tab per server, or `--headless`. Across servers this cannot happen any
  more: every reply names the checkout it serves and the CLI refuses a
  mismatch, which is also what lets a lane drive its own dev server with
  `--port`.
- Browser automation tabs are one shared pool across every lane. A lane that
  browses must open its own tab, verify the PORT in the address bar before
  every click, and close the tab when done — one lane's keypress landed in
  another lane's editor after a tab was navigated out from under it.
- Worktrees resolve `three` and `vite` only because `.agent-worktrees/` sits
  inside the main checkout and node walks up. Moving them needs `npm install`.
- Give each lane real file paths, never a bare glob — a claim starting with a
  wildcard has an empty prefix and claims the whole repository.

Write leftovers to `agent-runs/<date>-<name>/`, and record what was expensive
with `node bin/engine.mjs pain`.

## Writing files while it runs

The dev server watches `project/` and pushes what changed; `Live File Updates`
applies it. Editing a type moves live entities onto the new definition and keeps
per-placement overrides. A file with a syntax error is reported in `errors`
while entities keep running the last version that parsed.

Two things still reload the page: editing a **plugin** (it owns DOM and
listeners), and **deleting** any project file (Vite does not consult plugins on
unlink).
