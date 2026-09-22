# Evolving the engine

Improve the engine as games are built. Fix relevant friction when encountered;
at a completed milestone, review at most one other relevant ledger item.
Do not start an unrelated rewrite or an unattended maintenance loop.

## Authority

Make small, compatible engine fixes and improvements directly when they help
the game task. Pair each change with a reproduction, regression check, and
update to its owning guide. Tell the user what changed and what passed.

Ask before breaking public behaviour, adding dependencies, migrating data,
or broadly redesigning the architecture. Destructive or external actions still
need their own authority. A ledger entry is not permission to act.

## Record and select

Search existing records before adding one. `evolve <words>` returns one open
match; `insight.list <words>` also searches adopted solutions. Record concrete
steps, expected and actual results, and the relevant file or project path:

```sh
engine pain "Named editor cannot save" --where engine/server-config.mjs --repro "Open a named editor view and save a level" --expected "Level file changes" --actual "Save refused as a lane"
```

`insight` accepts the same evidence flags. Keep game defects in the game's own
tests and notes. Do not store secrets or private transcripts in the ledgers.

```sh
engine evolve
engine evolve save
engine evolve p353
```

Outside an engine terminal, use `node bin/engine.mjs` in place of `engine`.
The command reads the existing ledgers and returns one JSON brief. Without an
id, it selects the newest open record containing every search word. This is a
starting point, not a severity ranking. Use an explicit id for the current
blocker or a repeated problem. Closed and unknown ids are refused.

The command does not execute evidence, start an agent, claim files, create a
worktree, or resolve records. `verified: false` means the agent must still check
today's code. Review commands before running them in a safe test or game copy.

## Resolve one item

1. Reproduce against current code. Record the revision, steps, expected and
   actual results. If already fixed, verify the original task and close the
   stale record with evidence. If not reproducible, leave it open and name
   what is missing.
2. Choose the right scope. Keep game-specific rules in the game. Put a useful
   technique in its existing guide or tool. Promote a capability when a second
   game needs it. Fix a clear engine defect even after one occurrence.
3. Name the actual files in the brief's `prepare.request.files`. Do not treat
   the free-text `where` field as a claim. Use `agent.prepare` with that id and
   request; use the returned packet and workspace. A sole writer can stay in
   the current workspace. Concurrent writers need separate worktrees through
   `parallel: true`. Follow `docs/agent-workspace.md`, not a second run registry.
4. Keep code, regression check, and owning guide in one change. For docs-only
   work, verify the documented example. Remove obsolete advice and workarounds;
   do not append incident histories to instructions. Run `agent.skills` after
   guide changes and check the instruction packet for the next game task.
5. Run required checks and retry the original game task without its workaround.
   Use `agent.release` and, for a lane, `agent.merge`. Only after the change
   lands, use `pain.resolve` or `insight.adopt` with the landed change,
   reproduction, check result, original task result, and guide path.

The prepare id is a suggestion; if already used, take the free id the workspace
command supplies. Multiple ledger entries about one problem can cite the same
change. Do not implement duplicate fixes or close records merely because a
patch exists.

Judge progress by fewer repeated failures and fewer steps to build games,
not ticket count, added APIs, or lines of documentation.
