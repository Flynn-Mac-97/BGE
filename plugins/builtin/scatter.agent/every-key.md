# Every key

| key | shape | units | default | what it does |
| --- | --- | --- | --- | --- |
| `of` | `"tuft"`, `"tuft, stone"`, or a list whose entries are a name or `{ type, weight, mesh, properties }` | type names | `""` | what gets placed. `weight` is how often that entry comes up, relative to the others. `mesh` and `properties` are copied onto every placement of that entry. A name no type answers to is dropped and reported |
| `count` | number | placements | `0` | exactly this many. Wins over `density` |
| `density` | number | placements per square metre | `0` | a count worked out from the area's own size |
| `area` | `"box"`, `"disc"` or `"ring"` | — | `"box"` | which shape points are drawn from, centred on the scatter's own `at` |
| `width` `depth` | number | metres | `20` `20` | box only: the full span, so `60` reaches 30 m either side |
| `radius` | number | metres | `10` | disc and ring: the outer edge |
| `inner` | number | metres | `0` | ring only: the hole. Larger than `radius` swaps the two |
| `apart` | number | metres | `0` | least distance between two centres. `0` lets them touch |
| `clear` | list of `{ at: [x, z], radius }` or `{ type, radius }` | metres, world plan coordinates | `[]` | circles nothing may land in. The `type` form makes one circle around **every** entity of that type in the level |
| `corridors` | list of `{ path: [[x, z], …], width }` | metres, world plan coordinates | `[]` | lanes nothing may land in. `width` is the full lane, so `2.8` keeps 1.4 m off the centre line. A one-point path is a point |
| `yaw` | number or `[least, most]` | degrees about Y | `[0, 360]` | drawn per placement. **Rotation is drawn and not collided** — a turned solid still blocks its axis-aligned box |
| `scale` | number or `[least, most]` | multiplier | `1` | drawn per placement |
| `y` | number or `[least, most]` | metres | `0` | height above the scatter's own `at[1]`, drawn per placement |
| `sit` | `true` / `false` | — | `true` | lift each placement by half its own box height, so it stands on that height instead of being centred on it. Inert on a type with no `mesh.box` |
| `tries` | number | attempts per placement | `30` | how hard rejection sampling works before it gives up on one placement |
