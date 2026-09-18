<!-- Generated from plugins/builtin/object-descriptions.js; sha256 15b6535bbd199966199f726e31294c5aa06a47cb8c5824b4adeea50b94dbf551. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/object-descriptions.js). Where the prose below it disagrees, this is the code.

```
  plugin     Object Descriptions
  category   agents
  points     1 panel
  commands   description (What the author says a thing is, what a correct one looks like, and what a broken one looks like)
             description.missing (Which types have no about, appearance or looksWrongWhen yet — the backfill worklist)
             description.record (Record the tint, model, texture and box a type's description was written against, so a later change is caught as drift)
  arguments  description: options
  arguments  description.missing: none
  arguments  description.record: options
  emits      world:changed
  source     371 lines
```
