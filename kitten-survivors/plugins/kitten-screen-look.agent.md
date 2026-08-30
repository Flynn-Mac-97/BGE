# Kitten Screen Look

- What every screen in this game is made of: the palette, the display face, the
  item kinds Screen draws, and the picture each upgrade wears. Kitten Run HUD
  and Kitten Progression lay screens out; neither paints.
- The numbers come from `kitten-survivors/art/interface/bible.md` — bright,
  strongly coloured, few large shapes, legible over a lit meadow.
- **Item kinds it adds to Screen:**
  - `{ plate, cap, badge, picture, fill, color, size, textSize, radius }` — a
    fat rounded tile with a heavy dark edge and one big number, picture or
    glyph. `picture` names an upgrade id and wins over `plate`.
  - `{ meter: 0..1, label, name, color, back }` — a bar with its label inside.
  - `{ mark: { name, health }, at, foot, width, color }` — an actor's name, its
    health bar and its ground ring, in screen coordinates, already projected.
  - `frost(0..1)` — the world behind a menu, blurred and drained, then covered
    by a pale veil that much. **Build it with `frost(amount)`, not by hand.**
    Never a black wash: a menu that multiplies the world into the floor reads
    as a crash and hides the scene the player is going back to.
- **The world picture.** A frame system copies the world canvas while the world
  is held, and the frost blurs that copy over the sharp one. Copied, not read
  at paint time: a WebGL drawing buffer reads back empty once the browser has
  composited it, and a screen paints only when its items change. `frost()`
  carries the copy's number, which is what makes the menu repaint on a new one.
  The copy is drawn over the world, so a frost also survives `see.capture`.
  Nothing is copied while the world runs, so a run pays nothing for this.
- **Upgrade pictures**: `drawGlyph(g, id, x, y, size, colour)` draws the picture
  for an id from Kitten Upgrades and answers `false` when there is none, so the
  caller falls back to the character. A picture says the thing — a paw with
  speed streaks, a ball with a loose thread, two fangs.
- Exported for import: `drawGlyph`, `outlined`, `frost`, `DISPLAY`, and the palette
  `INK OUTLINE DEEP GEM BLOOD GOLD GREEN QUIET`. A Screen painter is a module
  function and is handed no context, so the export is the door it uses;
  `context.kittenLook` is the same code for anything that has a context.
- `frost` reads as nothing through `screen.read`, like `dim`. Only words are
  read back.
- Commands: `kitten.glyphs` — which upgrades have a picture.
