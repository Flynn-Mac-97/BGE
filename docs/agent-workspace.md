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
shape. `agents/art.md` is the worked example: a character is a Blender model, a
few solids are `mesh.parts`, a box is a blockout. Without a ranking, an agent
takes the first route it can see, and a gated skill it never triggers may as
well not exist.

So when a run teaches something:

- A rule that is always true → `agents/core.md`, the one node with `always`.
- A route with choices and costs → an instruction node with `match:` on the files
  it applies to, and `triggers:` on the words a task uses to describe the job.
- A tool with a setup cost → a `skill`, `optional`, so it costs nothing until wanted.
- Something about one plugin → its `.agent.md` sidecar.

Write only the rule, in imperative form. Never write the mistake or run that
taught it into the instruction — that history goes in git and the pain ledger,
and every retold mistake is paid for on each packet and primes the failure it
describes.

Check what a real task pulls before trusting it:
`node bin/engine.mjs agent.context '{"task":"...","files":["..."]}'`. A `triggers`
list is only as good as the words people actually write.

None of it is fixed. A node describing a route better ones have replaced is
worse than no node, so each file says to update it in the same task that finds
the better route.

## Which project

A project is a directory anywhere on disk, so a `match:` pattern writes
`project/**` and the resolver rewrites a claimed file to `project/…` before
matching. Three spellings reach the same file and an agent may hold any of
them: the full path, the directory's own name, and `project/` itself. Without
the rewrite a game in any other directory matches no project rule and the
packet still returns successfully.

A `tests:` entry writes `<project>`, replaced with the path in use, so a lane is
handed the check that proves its own game rather than the default one.

`engine/agent-workspace.js` is the shared resolver. It receives a file reader,
so the Agent Workspace plugin and the offline CLI return the same packet.
Each plugin's parsed interface is stored in `<plugin>.agent/interface.generated.md`.
The server generates these at startup and refreshes them on plugin edits. Packet
creation checks source and generator hashes, refreshes stale files, and reads the
stored text. The browser requests this through the file transport. Commands,
arguments, declared input schemas, context keys and events are generated; usage
rules and detail links remain in the authored guide. A missing interface is named
in the packet with the source to read.
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
plugin are included in any plugin task — and, being a plugin, it can grow
commands and tests like any other.

## Project overrides

Engine instructions may name an `override` key. A project instruction with the
same key replaces that engine instruction for matching project files. This is
for local style and workflow rules, such as code style or comment style. Engine
safety rules do not expose a key and cannot be replaced.

Git stays on the Node side. `engine/agent-workspace-node.mjs` backs
`agent.prepare` and `agent.release`, keeps the run registry in
`.engine/agents.json`, rejects overlapping claims, and creates a git
worktree only for a parallel writer. A small single-writer task stays in the
current workspace. The browser can inspect this state but cannot execute git.

This split is deliberate: instruction routing is portable engine behavior;
process and worktree management is CLI behavior.

## Several agents at once

Read this before fanning out. Not everything here is enforced — the table below
says which guarantees are real.

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

Check the `lanes` list, not just that a packet came back. A packet with no
matched rules is not an error — it returns successfully and looks like a full
one, only shorter.

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
- Browser automation tabs are one shared pool across every lane, and another
  lane can navigate a tab at any time. A lane that browses must open its own
  tab, verify the PORT in the address bar before every click, and close the
  tab when done.
- Worktrees resolve `three` and `vite` only because `.agent-worktrees/` sits
  inside the main checkout and node walks up. Moving them needs `npm install`.
- Give each lane real file paths, never a bare glob — a claim starting with a
  wildcard has an empty prefix and claims the whole repository.

Write leftovers to `agent-runs/<date>-<name>/`, and record what the ENGINE made
hard with `node bin/engine.mjs pain`. The pain log is the engine's friction
ledger, not a bug tracker for the game being built: "the spawn ring is too wide"
is a finding for your report; "nothing told me the level file is generated" is a
pain. The test is who has to act — a pain is fixed by changing the engine, its
tools, or its instructions.

Record what worked with `node bin/engine.mjs insight`. The same test decides
what belongs: an insight is a way of working the ENGINE should make easy, not a
fact about one game. `--saves` is the tokens the next agent will not spend
because you wrote it down, and it is what ranks the list — an un-adopted insight
with a large saving is the next thing to build. Search before you solve
something hard: `insight.list <words>` matches the `--problem` you were given.

## Writing files while it runs

The dev server watches `project/` and pushes what changed; `Live File Updates`
applies it. Editing a type moves live entities onto the new definition and keeps
per-placement overrides. A file with a syntax error is reported in `errors`
while entities keep running the last version that parsed.

Two things still reload the page: editing a **plugin** (it owns DOM and
listeners), and **deleting** any project file (Vite does not consult plugins on
unlink).


## Discover command and plugin contracts

Before guessing command arguments, run `node bin/engine.mjs --headless run agent.commands '{"query":"words"}'`.
Use `run agent.contracts '{"plugin":"Exact Display Name"}'` to inspect owned services and scheduling dependencies.
Follow nextOffset for another page. Undeclared schemas and legacy lifecycle ownership are explicit gaps; consult the guide for those plugins.
