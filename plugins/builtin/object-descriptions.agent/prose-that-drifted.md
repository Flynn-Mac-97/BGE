# Catching prose that no longer matches the art

```sh
run description.record '{"type":"rat"}'
```

Records the type's tint, model, texture and box as what `appearance` was
written against. After that, `description` and `description.missing` carry a
`stale` block naming each field that has changed since, with its old and new
value. A type with no recorded basis is never called stale — silence rather
than a guess, so the warning only ever follows a deliberate checkpoint.

Re-run it when the prose is rewritten to match, or when the art changed and the
sentence still holds.
