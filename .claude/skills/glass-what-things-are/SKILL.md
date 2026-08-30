---
name: glass-what-things-are
description: What an object IS, in its author's own words — the sentence written when it was made, not a guess reverse-engineered from its name, box, colour or code. Use when something in a level or on screen is unidentified, before reading a type file to work out what it is, and to check whether the art still matches what the author said.
---
<!-- generated from plugins/builtin/object-descriptions.agent.md at server start; edits are lost -->

# Object Descriptions

An object's identity cannot be measured. Its name, box, colour and position do
not say what it is for, and working it out from the code costs an afternoon and
is often wrong. Three strings written on the type say it once, and every agent
surface reads them.

## Check an authored sentence against the picture

This is the workflow the verbs exist for, and the first thing to run when a
description feels off:

```sh
run description '{"type":"rat"}'          # what the author says a correct one looks like
run see.capture '{"subject":"rat-80"}'    # what one actually looks like
```

Ask the picture the positive question first — what do you see — then compare it
against `appearance` yourself. Where the two disagree, the disagreement IS the
finding: either the art changed and the sentence went stale, or the art is
broken. Nothing in the engine checks these sentences, so this comparison is the
only thing that catches a stale one.

Never paste `appearance` into the question you ask a vision model. A model
adopts a judgement it is handed and will report seeing whatever you described.
That is why `appearance` is absent from every See sidecar.

## Something on screen and you cannot name it

```sh
run see.capture '{}'                      # read the mark number off the outline
                                          # marks["7"] -> the id
run description '{"of":"rat-80"}'
```

`looksWrongWhen` is the row that pays for itself. A big featureless block of
flat colour is usually a broken appearance, not a thing you failed to
recognise.

The sidecar's `about` names every marked type. `undescribed` names the marked
types nobody has written yet, so silence never reads as "nothing to know".

## The three fields

Plain strings on a type's default export, as the first keys, above `mesh`.
Never nested, never a behaviour, all three optional. Absent means absent — an
empty string or a default sentence is a confident lie the next agent repeats.

| field | says | cap |
|---|---|---|
| `about` | what it IS and what it does | 100 |
| `appearance` | how a CORRECT one reads on screen | 200 |
| `looksWrongWhen` | how a BROKEN one reads, and what is broken | 200 |

`about` is the only one that reaches a See sidecar, once per marked TYPE in the
frame. That is why it is the short one: its cost is multiplied by how many
types a frame holds, never by how many entities.

Caps are reported by `check` and `description.missing`, and nothing anywhere
truncates a sentence.

Write literally. "Slow melee enemy. Walks straight at the player. Low, long,
dull brown, close to the ground." A number belongs in `properties`, not here —
a copied number is the part that goes stale.

## The placement note

`note` on a placement in a level JSON says why THIS one is here. It adds to
what the type says and must never restate or contradict it, because the sidecar
legend says a type's identity once. No cap.

```sh
run engine.set '["crate-7", "note", "the stack a plant is thrown behind"]'
```

The Inspector's "Why this one is here" box writes the same field.

## Backfilling

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

## Catching prose that no longer matches the art

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

## Where the data lives

The three strings are on the type definition and the note is on the entity, so
`engine.entity`, `.engine/index.agent.json`, `see.describe`, `see.find` and
`see.isolate` all answer with this plugin disabled, headless, and with no
renderer. This plugin owns the two verbs and the panel, and owns none of the
data.
