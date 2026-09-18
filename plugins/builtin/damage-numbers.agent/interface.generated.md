<!-- Generated from plugins/builtin/damage-numbers.js; sha256 cd5507adc7043c02b905bb27d3b498726821969bbe39f268b22b6322ca8941c1. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/damage-numbers.js). Where the prose below it disagrees, this is the code.

```
  plugin     Damage Numbers
  category   game
  commands   damage.numbers (Numbers in the air)
             damage.number (Show one number)
  arguments  damage.numbers: none
  arguments  damage.number: args
  context    context.damageNumbers
  systems    fixed, frame
  listens    entity:hurt, level:loaded, shell:ready
  source     300 lines
```
