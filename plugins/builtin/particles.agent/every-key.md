# Every option

`burst` returns the record it filed, or `null` when it refuses. Every option, with its default:

| key | default | meaning |
|---|---|---|
| `at` | **required** | world metres, `{x,y,z}` or `[x,y,z]`. Missing means nothing is made, reported once |
| `to` | none | spread the count evenly from `at` to here — a tracer is a line, not a ball |
| `count` | `0` | clamped to 0…3000 |
| `direction` | none | normalised here. The direction particles travel |
| `spread` | `0.4` with a direction, `π` without | half-angle in radians. `π` is a sphere |
| `speed` | `0` | metres per second |
| `life` | `1` | seconds. Floored at one fixed step, so `life: 0` flashes once |
| `size` | `0.08` | metres |
| `grow` | `0` | metres per second added to `size` — size over life |
| `gravity` | `0` | metres per second² on Y. **Negative falls** |
| `drag` | `0` | fraction of speed shed per second, never below 0 |
| `fade` | `true` | alpha over life. Read by the painter |
| `colour` | `'#ffffff'` | hex, or a list to pick one from |
| `fadeTo` | none | hex it slides to — colour over life |
| `texture` | `''` | without one the painter draws a soft dot |
| `blend` | `'normal'` | `'add'` or `'normal'`; anything else is normal |
| `blocks` | `0` | metres of radius. Above zero the burst also declares a sight-blocking cloud |
| `blockGrow` | `max(0.5, blocks) / 1.5` | metres per second the cloud opens out to that radius |

`speed` `life` `size` each take a `[least, most]` pair as well as a number. One draw from the random stream either way, so the shape of the option cannot change the sequence.
