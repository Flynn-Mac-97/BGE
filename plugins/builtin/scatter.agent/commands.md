# Commands

- `run scatter.list` — every scatter, what its rule resolves to, how many it
  placed, and how much of it is standing. This is the answer to "why is my field
  empty".
- `run scatter.preview '{"id":"tufts"}'` — grow it in the editor to look at. No
  id grows all of them, in level order, which is exactly what play would grow.
  **It marks the world simulated**, so the kernel refuses to save while a preview
  is up; without that an edit would write the whole field into the level file.
- `run scatter.clear` — every preview down, and the save refusal lifted.
- `run scatter.expand '{"id":"tufts"}'` — write the field out as real
  placements, remove the scatter marker, and save. A field already previewed is
  reused, so what you looked at is what is written. Needs the clock stopped.
  From then on the placements are ordinary entities you can select and nudge.
