/**
 * Entity handles pack a slot index and a generation into one safe integer. A
 * recycled slot gets a fresh generation, so a stale handle never validates
 * against the entity that takes its place.
 *
 * Layout: the low 20 bits are the slot index (up to 1,048,576 concurrent
 * entities); everything above is the generation.
 */
const ENTITY_INDEX_BITS = 20;

/** Number of slots the low-bit index can address. */
export const ENTITY_INDEX_LIMIT = 2 ** ENTITY_INDEX_BITS;

/** Combine a slot index and generation into a stable entity handle. */
export function entityHandle(slotIndex, generation) {
  return generation * ENTITY_INDEX_LIMIT + slotIndex;
}

/** Extract the reusable slot index from an entity handle. */
export function entitySlotIndex(entity) {
  return entity % ENTITY_INDEX_LIMIT;
}

/** Extract the generation, used to reject stale handles. */
export function entityGeneration(entity) {
  return Math.floor(entity / ENTITY_INDEX_LIMIT);
}
