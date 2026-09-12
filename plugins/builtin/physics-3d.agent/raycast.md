# Casting a ray from a terminal

```sh
run physics3d.raycast '[[0,1.6,0],[0,0,-1],40]'
run physics3d.raycast '{"from":"player-0","to":"goal-a"}'
run physics3d.raycast '{"from":"bot-2","direction":[1,0,0],"ignore":"crate-a"}'
```

The array form is `[from, direction, maxDistance]`. The object form takes
`from`, and then either `direction` or `to`.

| key | takes |
|---|---|
| `from` | a point `[x, y, z]` or an entity id |
| `to` | a point or an entity id. Sets the direction, and the distance unless one is given |
| `direction` | any vector with a length. It is normalised here, so a hand-typed one works |
| `maxDistance` | metres. Defaults to 1000, because JSON has no infinity and no map is a kilometre across |
| `ignore` | an entity, an id, or a list of either |

A ray fired from an entity id skips that entity, so a shooter never hits
itself.

The reply gives the normalised `from`, `direction` and `maxDistance`, and `hit`
as the entity id, its type, the distance in metres, the point, and the surface
normal. No hit is `null`.

# What physics3d.bodies reports

- Every dynamic body: id, position, velocity, grounded flag, collider box.
- `against` — how many solids, triggers and other colliders it is tested
  against.
- `contacts` — the pairs currently touching.
- `grid` — the broadphase grid's own numbers.
