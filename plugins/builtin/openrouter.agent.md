---
description: Reaching any model OpenRouter serves — the key, the verbs, the Decisions route, and typed answers. Use when choosing a model by price, or when a key is missing or refused.
match: plugins/builtin/openrouter.js
triggers: openrouter, open router, which model, model by price, api key for a model, ask a model, typed decision, jev, decisions
category: harnesses
---

# OpenRouter

One door to every model OpenRouter serves. The engine hosts no model; this
reaches one.

## The key

- `OPENROUTER_API_KEY` wins when set. Use it for an agent, a lane and CI.
- Otherwise the key is read from `.engine/openrouter.json`, which git ignores.
  Set it in the OPENROUTER panel or with `openrouter.key`.
- No verb returns the key. `openrouter.key` with no argument answers
  `{ found, where, last4 }`.
- The panel runs in the browser, so the key reaches the page when it uses it. A
  hosted setup must keep the key server-side.

## The verbs

```sh
node bin/engine.mjs --headless run openrouter.models '{"query":"flash"}'
node bin/engine.mjs --headless run openrouter.ask '{"model":"z-ai/glm-5.3-flashx","prompt":"…"}'
node bin/engine.mjs --headless run openrouter.decisions '{"state":{…},"questions":{…}}'
node bin/engine.mjs --headless run openrouter.check
```

- `openrouter.models` needs no key. Each row carries context length and price
  per million tokens in and out.
- `openrouter.ask` takes `model`, `prompt`, and optionally `system`,
  `temperature`, `maxTokens` and `schema`. It answers
  `{ model, text, value, finish, usage }`.
- `openrouter.decisions` is the Decisions route, not chat completions: one
  `POST /api/alpha/decisions` with `{model,state,questions}` and answers keyed
  by question id. `plugins/builtin/jev.js` builds on it for agent triage.
- `openrouter.check` proves the key and reports what it is worth.

## Typed answers, not prose

Pass a schema and `value` comes back parsed. A reply that is not JSON leaves
`text` as written, so check `value` before trusting it.

A Decisions answer carries `choice`, `probabilities` and `confidence`. Rank by
the probability mass against the negative label, not the scalar confidence: a
clear `required` split scores low confidence and is still the right answer.
Batch independent questions into one call; one answer is not context for
another.

## The proxy

`OPENROUTER_PROXY_URL` attaches an HTTP proxy to OpenRouter requests alone,
through a request-scoped node dispatcher. The pi process, a global dispatcher
and the Windows proxy are never touched, and `NO_PROXY` does not bypass it. The
browser cannot set a proxy for fetch, so there the request is direct.

## Rules

- Keep the workflow in code; ask a model only where a rule cannot state the
  answer.
- Name the model; a default silently picks who is paid and how much.
- A refusal carries OpenRouter's own words. Read it before retrying — a missing
  key, an unknown model and an empty balance all read differently.
