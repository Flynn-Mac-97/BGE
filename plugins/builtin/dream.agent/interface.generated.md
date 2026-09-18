<!-- Generated from plugins/builtin/dream.js; sha256 9b0c8f1a856c41917900e5f2d477e03b8f68b8a9f19569948ee2b0564a88f613. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/dream.js). Where the prose below it disagrees, this is the code.

```
  plugin     Dream
  category   agents
  points     1 panel
  commands   dream.improve (Dream: improve a target, [ctrl+alt+d], refuses without a host)
             dream.rsi (Dream: run the recursive self-improvement loop, refuses without a host)
             dream.status (Dream: what the runs are doing, refuses without a host)
             dream.stop (Dream: ask a run to stop, refuses without a host)
             dream.report (Dream: the document a run wrote about itself, refuses without a host)
             dream.forget (Dream: throw a finished run away, refuses without a host)
  arguments  dream.improve: target, options = {}
  arguments  dream.rsi: target, options = {}
  arguments  dream.status: directory
  arguments  dream.stop: directory
  arguments  dream.report: directory
  arguments  dream.forget: directory
  source     252 lines
```
