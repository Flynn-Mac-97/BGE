---
name: brief-agents
description: Write a short requirements-only brief that hands a task or a new project to another agent. Use when delegating a build or spinning up a fresh agent; it sets the boundary and lets the receiving agent's own guidelines drive the design and style.
---

# Brief agents

A brief is how we hand work to a fresh agent. It is **one screen**: it sets the
boundary and the acceptance, and nothing more. The receiving agent already has
`AGENTS.md` and the skills, and those own the design and the style. A brief that
enumerates requirements as `R1..Rn`, pastes a library's API, or draws the shape of the
code has become a spec — cut it back.

A good brief reads like the prompt you would type to start the agent yourself.

## The structure

```
Read AGENTS.md and the skills under .pi/skills first; they define how code must be written here.

Task: <one or two sentences — the goal and what "done" looks like.>

Context:
- <where it lives, what it reuses, how it is run>
- <the few constraints that bound the work>

Requirements:
- <a handful of observable boundaries; only the non-obvious edges>

Follow AGENTS.md and the skills; how you edit existing code matters. Do not run git
commands. Finish with a short summary: what you added, how it is invoked, and what you
deliberately left out.
```

## Rules

- **One screen, one boundary.** If it needs scrolling, it is a spec. Aim for ~20-30 lines.
- **Give the skill, not the design.** Point at `AGENTS.md` and the skills; never specify
  modules, files, data structures, or algorithms.
- **Observable acceptance only.** "`npm run check` passes", "2,000 entities stay smooth"
  — not a numbered spec.
- **State only the non-obvious edges.** The receiver can read the code; don't paste the
  library's public API or a module tree.
- **Constrain, don't dictate.** Dependencies, platform, and integration points are
  constraints; the shape of the code is the agent's call.
- **No git.** The receiving agent edits the tree; committing is the orchestrator's job.

## Anti-patterns

- A numbered requirements document (`R1`…`R13`) with headed sections — that is the
  design, not the boundary.
- "Use a class with a map of components" — the receiving agent chooses.
- Re-quoting a library's full public API, or drawing its module tree, when the agent can
  read it.
- Acceptance that isn't observable ("it works well", "make it clean").

## CodeMap

For work on an **existing** codebase, a few lines of `codemap deps <dir>` (or `system`)
can orient the receiver. For a **new** project there is nothing to map — skip it. Keep
any map to a handful of lines; the agent can run CodeMap itself.
