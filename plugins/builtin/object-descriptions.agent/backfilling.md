# Backfilling

```sh
run description.missing
```

Reported per FIELD, not per type. The realistic shortfall is every type
carrying `about` and none carrying the other two, and a per-type count hides
exactly that. Run it until every list is empty. A non-empty `looksWrongWhen`
list is unfinished work, not a nearly-done one.

Backfilling is extraction, not invention: the identity sentences are usually
already in the file's doc comment. Move them down into the export and leave the
reasoning above. No sentence may exist in two places.
