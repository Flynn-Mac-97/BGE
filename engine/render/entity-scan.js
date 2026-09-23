/**
 * Kernel: the quiet snapshot and the two scans over it.
 *
 * `sync` visits every entity every frame and the usual frame changes nothing,
 * so the quiet scan answers the unchanged ones and the full pass runs only for
 * what it could not. A playing frame moves everything, so the moving scan
 * answers what only moved.
 */
export function makeEntityScans(state, records) {
  // The scratch place and the matrix writer are the record module's; the moving
  // scan reuses both rather than measuring a place it already has.
  const { placeMatrix, drawnPlaceScratch } = records

  /**
   * One entity's frame state, in one flat array of fixed-size slots.
   *
   * `sync` visits every entity every frame, and the common frame changes
   * nothing: proving that is the whole cost. Parallel arrays — one per field —
   * put one entity's values in a dozen separate regions of the heap, so every
   * visit paid a dozen cache misses for a dozen compares. A slot here holds them
   * together, so one entity is a couple of cache lines, and the array is walked
   * in order. At fifty thousand entities that is most of the scan.
   *
   * A slot belongs to the entity it held last: the first cell is the test. A slot
   * whose entity changed — a spawn, a removal that shifted the rest, a reorder —
   * falls through to the full pass, which rewrites it. The WeakMap record stays
   * the authority for slow-path state; this only answers "is this still the
   * entity the last pass drew".
   */
  const SLOT_STRIDE = 16
  const SLOT_OBJECT = 1
  const SLOT_MESH = 2
  const SLOT_COLLIDER = 3
  const SLOT_TYPE = 4
  const SLOT_X = 5
  const SLOT_Y = 6
  const SLOT_Z = 7
  const SLOT_SCALE = 8
  const SLOT_YAW = 9
  const SLOT_HIDDEN = 10
  const SLOT_OPACITY = 11
  const SLOT_FLAGS = 12
  // What the moving scan needs to place an entity and let the marks follow,
  // copied here so that scan never touches the entity's record: the record is a
  // second heap object per entity and a cache miss the flat array does not pay.
  const SLOT_ANCHOR = 13
  const SLOT_DECLARED = 14
  const SLOT_SHAPE = 15
  /** What the quiet test needs set, and the marks the scan reports. */
  const SLOT_QUIET = 1
  const SLOT_OUTLINE = 2
  const SLOT_STEADY = 4

  const snapshot = []

  /**
   * The place the last frame drew each entity at, as plain doubles.
   *
   * The snapshot above holds objects and numbers in one array, so a fractional
   * position written into it is a heap number — one allocation per entity per
   * frame, which a playing frame then pays to collect. A typed array stores the
   * place unboxed, and the place is the only number a moving frame rewrites on
   * every entity.
   */
  const DRAWN_STRIDE = 3
  let drawnPlaces = new Float64Array(0)

  /** Room for one drawn place per entity, keeping what is already there. */
  function growDrawnPlaces(length) {
    if (drawnPlaces.length >= length * DRAWN_STRIDE) return
    const next = new Float64Array(length * DRAWN_STRIDE)
    next.set(drawnPlaces)
    drawnPlaces = next
  }

  /** Forget slots past the end of the entity list, so a removed entity is not held. */
  function trimSlots(length) {
    if (snapshot.length > length * SLOT_STRIDE) snapshot.length = length * SLOT_STRIDE
  }

  /**
   * Record what the full pass just drew for one entity, for the next frame to
   * compare against.
   *
   * `sprite` is deliberately absent. A mesh entity draws from its mesh, and the
   * plan ignores a sprite while one is present, so a changed sprite cannot change
   * what this frame shows and does not have to be compared.
   */
  function saveSlot(index, entity, object, record) {
    const at = index * SLOT_STRIDE
    snapshot[at] = entity
    snapshot[at + SLOT_OBJECT] = object
    snapshot[at + SLOT_MESH] = entity.mesh
    snapshot[at + SLOT_COLLIDER] = entity.collider
    snapshot[at + SLOT_TYPE] = entity.type
    snapshot[at + SLOT_SCALE] = entity.scale
    snapshot[at + SLOT_YAW] = entity.yaw
    snapshot[at + SLOT_HIDDEN] = entity.hidden
    snapshot[at + SLOT_OPACITY] = entity.opacity
    snapshot[at + SLOT_X] = entity.x
    snapshot[at + SLOT_Y] = entity.y
    snapshot[at + SLOT_Z] = entity.z
    // The slot place and the drawn place hold the same three numbers: the
    // still scan compares the first, the moving scan the second.
    const drawn = index * DRAWN_STRIDE
    drawnPlaces[drawn] = entity.x
    drawnPlaces[drawn + 1] = entity.y
    drawnPlaces[drawn + 2] = entity.z
    snapshot[at + SLOT_ANCHOR] = record.anchor
    snapshot[at + SLOT_DECLARED] = record.declared
    snapshot[at + SLOT_SHAPE] = record.shape
    // Settled, idle and never moved: the answers that let the next frame skip
    // this entity, and whether it draws an outline while skipped. Steady is the
    // moving counterpart: a simple mesh, out of every batch, whose outline is
    // already resolved, so a frame that only moved it needs to write a place.
    snapshot[at + SLOT_FLAGS] =
      (record.settled && record.idle && !record.moved ? SLOT_QUIET : 0) |
      (record.outline ? SLOT_OUTLINE : 0) |
      (record.steady ? SLOT_STEADY : 0)
  }

  /** The fields both scans need to match, and the slot each is remembered in. */
  const SAME_FIELDS = [
    [SLOT_MESH, 'mesh'],
    [SLOT_COLLIDER, 'collider'],
    [SLOT_TYPE, 'type'],
    [SLOT_SCALE, 'scale'],
    [SLOT_YAW, 'yaw'],
    [SLOT_HIDDEN, 'hidden'],
    [SLOT_OPACITY, 'opacity']
  ]

  /** Whether the slot still holds the entity's declaration, field for field. */
  function sameFields(entity, at) {
    for (const [slot, field] of SAME_FIELDS) {
      if (snapshot[at + slot] !== entity[field]) return false
    }
    return true
  }

  /** Whether the ring rule names this entity, so it may not be skipped. */
  function isRinged(entity, ringedId) {
    return ringedId !== null && (entity.id === ringedId || entity.type === ringedId)
  }

  /**
   * Whether the slot still holds the entity, turned and declared the same, with
   * the place left out.
   *
   * The still scan answers an entity that has not moved; the moving scan answers
   * one whose place it can write. Everything else has to match both times, so it
   * is compared once here. Each caller tests the slot's first cell first, which
   * is the cheapest way to reject a slot whose entity changed.
   */
  function sameApartFromPlace(entity, at, ringedId) {
    if (typeof entity.rotation === 'object') return false
    if (!sameFields(entity, at)) return false
    return !isRinged(entity, ringedId)
  }

  /**
   * Whether the entity in slot `at` is the one the last full pass drew, has
   * never moved, and has not changed since. Such an entity is drawn exactly as
   * it was, on a still frame and on a playing frame alike.
   */
  function isQuiet(entity, at, ringedId) {
    return (
      snapshot[at] === entity &&
      (snapshot[at + SLOT_FLAGS] & SLOT_QUIET) !== 0 &&
      snapshot[at + SLOT_X] === entity.x &&
      snapshot[at + SLOT_Y] === entity.y &&
      snapshot[at + SLOT_Z] === entity.z &&
      sameApartFromPlace(entity, at, ringedId)
    )
  }

  /** The entities the quiet scan could not answer, filled by `scanQuiet`. */
  const dirtyIndices = []

  /**
   * The per-entity cost of a still frame, in a function of its own.
   *
   * Every entity that did not change is answered here and never reaches the full
   * pass. This is the hot loop, and it is deliberately small: V8 optimizes a
   * function as one unit, and the same compares inlined into `sync` are large
   * enough to be left in the interpreter, which costs about three times as much.
   *
   * Returns how many quiet entities draw an outline, and leaves the indices of
   * everything else in `dirtyIndices`.
   */
  function scanQuiet(entities, frame, sweep, ringedId) {
    dirtyIndices.length = 0
    let keylines = 0
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      const at = i * SLOT_STRIDE
      if (isQuiet(entity, at, ringedId)) {
        if (sweep) snapshot[at + SLOT_OBJECT].userData.seen = frame
        if (snapshot[at + SLOT_FLAGS] & SLOT_OUTLINE) keylines++
        continue
      }
      dirtyIndices.push(i)
    }
    return keylines
  }

  /**
   * Whether the moving scan can place this entity without measuring it again.
   *
   * It must be the entity the last pass drew, steady, and moved since — and its
   * declaration unchanged, which `sameApartFromPlace` answers.
   */
  function isPlaceable(entity, at, drawn, flags, ringedId) {
    if (snapshot[at] !== entity) return false
    if ((flags & SLOT_STEADY) === 0) return false
    if (drawnPlaces[drawn] === entity.x && drawnPlaces[drawn + 1] === entity.y && drawnPlaces[drawn + 2] === entity.z)
      return false
    return sameApartFromPlace(entity, at, ringedId)
  }

  /** Move an entity's object to its blended place, and let the marks follow it. */
  function placeMoving(entity, object, at, blend, drawInto) {
    const place = drawInto(drawnPlaceScratch, entity, blend)
    object.position.set(place.x, place.y + snapshot[at + SLOT_ANCHOR], place.z || 0)
    // The record keeps the last transform written so a later full pass can tell
    // a real move from a pose change; this fast path moves the object, so it
    // writes through the same bookkeeping rather than around it.
    placeMatrix(object, object.userData.record)
    // The keyline hangs off the object and moves with it, so only the ground mark
    // has to be written again.
    if (!entity.hidden) {
      state.moveMarks(entity, snapshot[at + SLOT_DECLARED], snapshot[at + SLOT_SHAPE], place)
    }
  }

  /**
   * The per-entity cost of a playing frame, in a function of its own.
   *
   * A playing frame moves every entity and draws it between its last two steps,
   * so the quiet scan cannot answer it. Almost every one of those entities is
   * the same thing it was last frame except for its place: same declaration,
   * same turn, same scale, same outline. This scan writes the interpolated
   * place and the contact shadow that follows it, and leaves everything else
   * exactly as the last full pass left it. Whatever it cannot answer goes to
   * the full pass through `dirtyIndices`.
   */
  function scanMoving(entities, blend, drawInto, ringedId) {
    dirtyIndices.length = 0
    let keylines = 0
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      const at = i * SLOT_STRIDE
      const drawn = i * DRAWN_STRIDE
      const flags = snapshot[at + SLOT_FLAGS]
      // A level in play is mostly things that never move. Their place before
      // the step is their place now, so they are drawn as the last pass left them.
      if (isQuiet(entity, at, ringedId)) {
        if (flags & SLOT_OUTLINE) keylines++
        continue
      }
      if (isPlaceable(entity, at, drawn, flags, ringedId)) {
        placeMoving(entity, snapshot[at + SLOT_OBJECT], at, blend, drawInto)
        drawnPlaces[drawn] = entity.x
        drawnPlaces[drawn + 1] = entity.y
        drawnPlaces[drawn + 2] = entity.z
        if (flags & SLOT_OUTLINE) keylines++
        continue
      }
      dirtyIndices.push(i)
    }
    return keylines
  }

  return { scanQuiet, scanMoving, dirtyIndices, growDrawnPlaces, trimSlots, saveSlot }
}
