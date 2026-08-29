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
current workspace. Completion is refused until every lane-required check is
recorded. The browser can inspect this state but cannot execute git.

This split is deliberate: instruction routing is portable engine behavior;
process and worktree management is CLI behavior.

## Writing files while it runs

The dev server watches `project/` and pushes what changed; `Live File Updates`
applies it. Editing a type moves live entities onto the new definition and keeps
per-placement overrides. A file with a syntax error is reported in `errors`
while entities keep running the last version that parsed.

Two things still reload the page: editing a **plugin** (it owns DOM and
listeners), and **deleting** any project file (Vite does not consult plugins on
unlink).
