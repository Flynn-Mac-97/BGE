# Agent workspace

> One of the engine design docs — the index is [ARCHITECTURE.md](../ARCHITECTURE.md).

## The instruction tree

Agent instructions follow the same disk-first rule as the game. The generated
root `AGENTS.md` is only a bootstrap. `ENGINE-BASE.md` is the base instructions
every agent reads first — speech, code and comment style at a glance, with
links out to the detailed rules. `agents/manifest.json` owns engine rules.
`project/agents/manifest.json` adds game rules. Parent ids join both manifests
into one visible tree.

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
| **file claims** | **advisory — no write path reads the registry (p54)** |
| **`--checked`** | **records that checks ran; runs nothing (p56)** |
| **closing a lane** | **no verb — merge, worktree remove and branch delete are manual (p55)** |

**The recipe today:**

```sh
git status --porcelain --untracked-files=all   # must be empty, or prepare refuses
node bin/engine.mjs agent.prepare <id> <file...> --parallel
# ... the lane works in .agent-worktrees/<id> ...
node bin/engine.mjs agent.release <id> --checked
git merge agent/<id> && git worktree remove .agent-worktrees/<id> && git branch -d agent/<id>
```

A worktree isolates **tracked** files only, so commit untracked work first or
lanes fight over exactly the files that are not in it.

**What still bites:**

- `npm test` is a required check for the engine, editor and tooling lanes, and
  it needs a dev server and one open editor tab — so N lanes cannot all satisfy
  it. Run it once, serially, in the main worktree at the end.
- Two editor tabs both answer the bridge and the first reply wins, so a
  state-dependent CLI call can read the other tab's world. One tab, or
  `--headless`.
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
