---
name: karpathy-guidelines
description: Behavioral guardrails against over-engineering and drive-by edits, derived from Andrej Karpathy's observations on LLM coding pitfalls. Use when implementing, reviewing, or refactoring code — especially to keep changes minimal, surface assumptions, and avoid speculative abstraction.
license: MIT
---

# Karpathy guidelines

Adapted from [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)
(MIT), derived from [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876)
on LLM coding pitfalls. These bias toward caution over speed; for trivial tasks, use
judgment.

## 1. Think before coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so and push back when warranted.
- If something is unclear, stop. Name what's confusing and ask.

## 2. Simplicity first

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Test: *would a senior engineer say this is overcomplicated?* If yes, simplify.

## 3. Surgical changes

**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove only the orphans your own change created (imports, variables, functions).

Test: *every changed line traces directly to the request.*

## 4. Goal-driven execution

**Define success criteria. Loop until verified.**

- "Add validation" → write tests for invalid inputs, then make them pass.
- "Fix the bug" → write a test that reproduces it, then make it pass.
- "Refactor X" → ensure tests pass before and after.

For multi-step work, state a short plan as `step → verify` pairs. Strong success
criteria let you proceed independently; "make it work" needs constant clarification.

## Self-check

- Am I answering the question that was asked, or a more general one I invented?
- Could this diff be a fraction of its size and still pass?
- Does every changed line trace to the request?
- Did I present my assumptions before building on them?
