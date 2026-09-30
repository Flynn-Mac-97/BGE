---
skill: none
---

# Panel Layout

- Lets people resize editor docks and fold panels to their header.
- Sizes and folds are local browser layout state.
- `layout.set '{...}'` — set the dock sizes.
- `layout.panels` — every drawn panel: dock, folded, height in pixels.
- `layout.fold '{"id":"render","to":"open"}'` — `to` is `folded` or `open`; leave it out to flip.
- `layout.reset` — sizes and folds back to their defaults.
- A panel record may set `collapsed: true` to start folded and `minHeight` (pixels, default 140) for the least height it keeps open. A dock scrolls when its open panels do not fit. Bottom-dock panels do not fold.
