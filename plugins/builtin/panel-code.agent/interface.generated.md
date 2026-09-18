<!-- Generated from plugins/builtin/panel-code.js; sha256 e2999e8cb3f85615845963662fff239487f8df3a649a3c4c6f0421c1b36706a7. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/panel-code.js). Where the prose below it disagrees, this is the code.

```
  plugin     Code Panel
  category   editor
  points     2 panels
  commands   code.open (Open a file)
             code.save (Save open file)
             code.toggle (Expand or collapse the editor)
  arguments  code.open: path
  arguments  code.save: none
  arguments  code.toggle: none
  listens    open:agent-file, open:file
  source     113 lines
```
