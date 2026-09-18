# Descriptions

`node bin/engine.mjs --headless run plugin.facts` answers with every plugin's
derived description. Name one to get its whole interface:

```sh
node bin/engine.mjs --headless run plugin.facts '{"plugin":"hot"}'
```

## The block a packet carries

Every plugin guide in an instruction packet arrives with the plugin's interface
printed above its prose from `<plugin>.agent/interface.generated.md`:

```
**Interface, parsed from source** (plugins/builtin/pickups.js). Where the prose below it disagrees, this is the code.

  plugin    Pickups
  category  game
  commands  pickups.list (What is waiting to be picked up)
            pickups.attract (Pull every pickup in now)
  context   context.pickups
  systems   fixed
  listens   level:loaded
  emits     pickup:collected {entity, collector, kind, value}
            pickup:latched {entity, collector}
  source    209 lines
```

Do not edit the generated file. The server refreshes it on plugin edits and at
startup. Packet creation checks hashes of both source and generator and replaces
stale files before reading them. Unchanged files require no parse. Commands carry
their parameter declarations and any declared input schema. Use the guide's
detail links for examples and limits that source cannot describe.

An empty row is left out rather than printed empty — a blank `listens` line would
read as "not measured", and the block is measured.

## What the derived line is

One sentence built from what the file declares, in a fixed order so the same
plugin is never worded two ways:

```
engine plugin: 1 command. adds context.audio, context.play. listens for play:started.
```

It comes from the syntax tree, not from a pattern over the text, so it survives
the shapes that defeat a scan: a description written as several literals joined
across lines, a name held in a top-level `const`, a key spelled as shorthand.

## What only source can answer

Four fields exist nowhere else, and they are the reason this reads source
instead of the loaded definition:

| field | what it is |
|---|---|
| `context` | keys the plugin assigns onto `context`, read anywhere in the file |
| `listens` | events it subscribes to on `context.bus` |
| `emits` | events it emits, with the payload keys of each `emit` call |
| `refusesWithoutHost` | per command: whether its body refuses where there is no host |

Everything else — name, category, lifecycle, contribution points, command ids and
labels, systems phases, `provides`/`requires`/`needs` — is on the definition too,
so the browser words the same line with no parser and no node.

## When the line reads wrong

Compare the generated line with the source. Fix the source when the declaration
is wrong, the reader when extraction is wrong, and the guide when prose is stale.
Dynamic declarations may require reading the source; static extraction does not
prove runtime behavior.

## What it cannot say

Why the plugin exists, and when to reach for it. That is the guide's job and no
reader can write it. `about` is optional for the same reason: the mechanical half
is derived, so an author only writes the half a machine cannot.
