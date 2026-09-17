# Shared rules

- Files on disk are true. Do not add a save-only copy.
- Use plain, exact names. Say what a thing does.
- Keep instructions short. Put one rule in one sentence.
- Preserve work you did not make.
- State your assumptions before you code. If the request has two readings, name both and ask. If a simpler route exists, say so.
- Write the least code that solves the task. Add no option or abstraction nobody asked for, and no handling for a case that cannot happen.
- Change only what the task needs. Match the style around you. Every changed line traces to the request.
- Turn the task into a check you can run. For a multi-step job, write `step → verify: check` and loop until the check passes.
- Write scratch files and run output in agent-runs/, never at the root. Nothing there is committed and `agent.sweep` deletes it after a week.
- A finding that must outlive the run goes in the pain ledger, the insight ledger, the guide it is about, or a test. Never a new markdown file.
- Write a test only for a behaviour that would break silently. A one-off proof is scratch and is deleted.
- A test is cheap, and it is one process doing one thing. A fan-out — several agents, a dozen worlds, a swarm of headless processes — is a tool run by hand under `tools/`, reporting numbers to read, never something that runs on every change.
- One writer may use the current workspace. Parallel writers need separate git worktrees.
- Run every check named in your task packet.
- Before solving something hard, check whether it is solved: `node bin/engine.mjs insight.list <words>`.
- Record engine friction: `node bin/engine.mjs pain "<what was hard>" --cost <tokens>`.
- Record a solution worth reusing: `node bin/engine.mjs insight "<what worked>" --problem "<when to use it>" --saves <tokens>`.
