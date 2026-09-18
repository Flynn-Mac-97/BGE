---
description: Builds the instruction tree and small task packets, claims files, and opens or merges a parallel lane. Use at the start of any task to get its packet, before fanning work out to several agents, and when a claim or worktree is refused.
category: core
---

# Agent Workspace

- Use this to build the instruction tree and small task packets.
- Optional skills stay out of context until enabled and matched.
- Use `agent.context`, `agent.prepare`, then `agent.release`, then `agent.merge`.

## The verbs

- `agent.context` — the packet for a task. Name the files; most rule sets are
  chosen by them.
- `agent.prepare <id>` — claim files and, with `--parallel`, take a worktree.
  An id already held by an unmerged run is refused, with a free one suggested.
- `agent.release <id>` — run the packet's checks and finish the run. Failing
  checks leave it active.
- `agent.merge <id>` — merge the lane, then remove its worktree and branch. The
  merge is recorded before cleanup, so a worktree this process cannot delete
  never costs the registry its record that the work landed.
- `agent.sweep` — delete what finished lanes left in `.agent-worktrees`. Only
  removes a worktree whose work is in HEAD. `--dry-run` lists without deleting.
- `agent.status` — live runs, lanes still to merge, and leftovers on disk.
  `--all` prints the raw registry.
- `agent.skills` — rewrite the generated `AGENTS.md`, `CLAUDE.md` and skill
  copies. The dev server writes these at start-up, so run it after editing a
  guide while the server runs. Which guides become skills is decided by
  `skillCategories` in `agents/manifest.json`: `core` alone is on, and a guide
  in a category that is off still reaches a packet naming its plugin.
- `agent.toggle` and `agent.create` — switch an optional skill on or off, and
  add an instruction or skill node. Editor verbs; they need a browser.

## Reading a run's state

State comes from git, not from the stored status: a verb that fails part way
writes nothing, and the commits are true either way. `agent.status` reports
`alreadyInHead` for runs git says landed and the registry does not, and
`needsMerge` only for a branch that still exists and is not an ancestor of
HEAD.
