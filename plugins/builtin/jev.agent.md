---
description: Opt-in semantic triage that ranks the optional guides a task needs and the ledger records a new finding relates to. Use when a task is vague, or before recording a finding that may already exist.
match: plugins/builtin/jev.js
triggers: jev, opt-in triage, suggested guides, related records, which guides, duplicate finding, semantic triage
category: harnesses
---

# Jev

Jev is a classifier, not a writer. Given candidates it labels each one, so it
can rank optional guides for a task or rank existing records beside a new
finding. It is off by default; nothing here calls a model until it is switched
on.

## Switch it on

```sh
node bin/engine.mjs jev.mode '{"on":true}'   # for this project
node bin/engine.mjs jev.mode                 # read the switch and the key
node bin/engine.mjs jev.mode '{"on":false}'  # off; no network call
```

`agent.context` then appends a `# Jev suggests` block naming the strongest
optional guides. One call can override the switch:

```sh
node bin/engine.mjs agent.context '{"task":"make the level look better","jev":true}'
node bin/engine.mjs jev.guides '{"task":"add a health bar"}'
node bin/engine.mjs jev.records '{"text":"the packet omits a guide the task needs"}'
```

## How it answers

- `openrouter.decisions` is the transport: one `POST /api/alpha/decisions` with
  `{model,state,questions}` and answers keyed by question id. It is not chat
  completions.
- Every candidate is one independent `choice` question in the same request, with
  the labels `required | possible | irrelevant` for guides and
  `same | related | unrelated` for records.
- A choice under the confidence floor, or one with no usable answer, is dropped
  with a reason. Rank order is by confidence. `possible` and `related` are kept
  apart from `required` and `same`.

## When it is unavailable

A missing key, an absent or dead proxy, a refusal, a timeout or a malformed
reply returns the ordinary behavior and a short reason. The packet is unchanged
and the record is never suppressed. There is one request and no retry.

The ranked pass runs from node. The browser cannot set an HTTP proxy for fetch,
so the plugin's `context.jev.mode` and `status` work there and the ranked
passes do not. `OPENROUTER_PROXY_URL` attaches a proxy to OpenRouter requests
alone; it never changes a global dispatcher or the pi process. `OPENROUTER_API_KEY`
wins over a stored key.

## What stays in code

Instructions, file matches, claims, permissions, checks and tests. Jev never
decides that work is fixed, never deletes, and never edits the ledger. Its
suggestions are advisory: verify against disk before acting.
