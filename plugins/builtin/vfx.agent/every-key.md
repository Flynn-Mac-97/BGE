# Every option

`beam` returns the record it filed, or `null` when it refuses. Every option, with its default:

| key | default | meaning |
|---|---|---|
| `from` `to` | **required** | world metres, `{x,y,z}` or `[x,y,z]`. Missing means nothing is made, reported once |
| `life` | `0.35` | seconds. Floored at one fixed step |
| `width` | `0.08` | metres across the ribbon |
| `jitter` | `0` | sideways displacement as a fraction of length. Above zero it is a bolt, not a beam |
| `segments` | `12` | clamped 2…48 |
| `flicker` | `0` | times per second the displacement is re-rolled |
| `taper` | `'both'` | `'both'` `'from'` `'to'` `'none'` |
| `colour` | `'#ffffff'` | hex, the halo |
| `core` | `'#ffffff'` | hex, the hot centre |
| `fadeTo` | none | hex the halo slides to over the beam's life |
| `blend` | `'add'` | `'add'` or `'normal'` |
