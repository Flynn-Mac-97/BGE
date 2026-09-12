---
name: glass-claim-guard
description: Refuses a write to a file another active agent run claimed. Use when a write is refused with 'claimed it', when setting up parallel agent runs, or to see which files are claimed right now.
---
<!-- generated from plugins/builtin/claim-guard.agent.md at server start; edits are lost -->

# Claim Guard

- Refuses a write to a file another **active** agent run claimed with `agent.prepare`. Without it the run registry is advice nothing reads.
- Node only. In the browser it guards nothing and `claims.list` says why — the editor is one writer, and these collisions happen between headless runs.
- Set `ENGINE_AGENT_ID=<your run id>` or your own claims refuse your own writes.
- `node bin/engine.mjs --headless run claims.list` — what is claimed, and whether the guard is on.
- A refusal reads `refused to write <path> — agent run "<id>" claimed it`.
- Claims are read once at plugin load, not per write. A run started mid-session is not yet claiming anything this process is about to overwrite.
- Turn it off in `game.json` to write freely. Deliberate: a guard nobody can disable is one people route around.
- The kernel side is `context.files.guardWrites(fn)` — return a reason to refuse, nothing to allow. Any plugin may register one; a guard that throws counts as a refusal.
