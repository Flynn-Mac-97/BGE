<!-- Generated from plugins/builtin/damage-numbers.js; sha256 b64a13a068fc35d2d5938b92c179cc8ea4595ac2795165fa644fccd5a38e939a. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/damage-numbers.js). Where the prose below it disagrees, this is the code.

```
  plugin     Damage Numbers
  category   game
  commands   damage.numbers (Numbers in the air right now)
             damage.number (Show one number by hand)
  arguments  damage.numbers: none
  arguments  damage.number: args
  context    context.damageNumbers
  systems    fixed, frame
  listens    entity:hurt, level:loaded, shell:ready
  source     300 lines
```
