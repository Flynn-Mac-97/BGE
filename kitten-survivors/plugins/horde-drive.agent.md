# Horde Drive

- How the horde moves. The Horde plugin decides what exists; this decides where
  it goes. One pass over the whole crowd each fixed step.
- Everything walks straight at the kitten. There is no pathfinding and there
  should not be — an enemy that can be out-thought is a different genre.
- `SEPARATION` is the number the look of the game hangs on. Above about 1.3 the
  horde orbits instead of closing; below about 0.7 it stacks into one column and
  three hundred rats read as one. Reach for it first if the crowd feels wrong.
- Family motion lives here because it is a rule, not a shape: crows and wasps bob
  at different rates, a boar stalks, braces for 0.45 s and then charges a locked
  straight line for 1.4 s. Rats and hounds do nothing, on purpose.
- The charge is locked through `entity.headingX` / `headingZ`, which Crowd reads
  as "already committed". A charge that tracked the player would be a tax rather
  than a tell.
- `run horde.spread` says whether the crowd is a crowd: overlapping pairs, the
  deepest overlap, and how many of twelve bearings around the player are in use.
  Eight or more is a ring; one or two is a queue.
