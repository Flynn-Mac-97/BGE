import {
  ENTITY_INDEX_LIMIT,
  entityGeneration,
  entityHandle,
  entitySlotIndex,
} from './entity-id.js';
import { matchEntities } from './query.js';

// Slot generations start at 1 so generation 0 is never a live handle.
const FIRST_GENERATION = 1;

/**
 * Mutable owner of every entity, component store, and lifecycle value. State
 * lives here because it carries invariants: a live slot index maps to exactly
 * one generation, and destroying an entity drops it from every store.
 */
class World {
  #generations = [];
  #alive = [];
  #freeSlots = [];
  #componentStores = new Map();
  #liveEntityCount = 0;

  /** Number of live entities. */
  get liveEntityCount() {
    return this.#liveEntityCount;
  }

  /** Create a live entity, recycling a slot and bumping its generation. */
  createEntity() {
    const slotIndex = this.#acquireSlotIndex();
    this.#alive[slotIndex] = true;
    this.#liveEntityCount += 1;
    return entityHandle(slotIndex, this.#generations[slotIndex]);
  }

  #acquireSlotIndex() {
    const recycled = this.#freeSlots.pop();
    if (recycled !== undefined) return recycled;
    const slotIndex = this.#generations.length;
    if (slotIndex >= ENTITY_INDEX_LIMIT) {
      throw new RangeError(`entity limit of ${ENTITY_INDEX_LIMIT} slots reached`);
    }
    this.#generations.push(FIRST_GENERATION);
    this.#alive.push(false);
    return slotIndex;
  }

  /** Destroy one entity and drop every component it owns. False if not live. */
  destroyEntity(entity) {
    if (!this.isAlive(entity)) return false;
    const slotIndex = entitySlotIndex(entity);
    this.#alive[slotIndex] = false;
    this.#generations[slotIndex] += 1; // invalidate every stale handle to this slot
    this.#freeSlots.push(slotIndex);
    for (const store of this.#componentStores.values()) store.delete(entity);
    this.#liveEntityCount -= 1;
    return true;
  }

  /** True when the handle names a live entity of the current generation. */
  isAlive(entity) {
    if (!Number.isInteger(entity) || entity < 0) return false;
    const slotIndex = entitySlotIndex(entity);
    if (slotIndex >= this.#generations.length) return false;
    return (
      this.#alive[slotIndex] === true &&
      this.#generations[slotIndex] === entityGeneration(entity)
    );
  }

  /** Attach or replace a component value. Throws when the entity is not live. */
  addComponent(entity, componentType, value) {
    const store = this.#storeFor(entity, componentType);
    store.set(entity, value);
    return value;
  }

  #storeFor(entity, componentType) {
    if (!this.isAlive(entity)) {
      throw new RangeError('cannot add a component to a non-live entity');
    }
    let store = this.#componentStores.get(componentType);
    if (store === undefined) {
      store = new Map();
      this.#componentStores.set(componentType, store);
    }
    return store;
  }

  /** The stored value, or undefined when absent. */
  getComponent(entity, componentType) {
    return this.#componentStores.get(componentType)?.get(entity);
  }

  /** True when the entity owns the component, even one whose value is undefined. */
  hasComponent(entity, componentType) {
    return this.#componentStores.get(componentType)?.has(entity) ?? false;
  }

  /** Drop one component; false when it was not present. */
  removeComponent(entity, componentType) {
    const store = this.#componentStores.get(componentType);
    if (store === undefined) return false;
    return store.delete(entity);
  }

  /**
   * Live entities carrying every requested component type, in slot order. An
   * empty request returns every live entity. The returned array is a snapshot.
   */
  query(componentTypes) {
    if (componentTypes.length === 0) return this.#liveEntities();
    return matchEntities(this.#componentStores, componentTypes);
  }

  #liveEntities() {
    const entities = [];
    for (let slotIndex = 0; slotIndex < this.#generations.length; slotIndex += 1) {
      if (this.#alive[slotIndex]) {
        entities.push(entityHandle(slotIndex, this.#generations[slotIndex]));
      }
    }
    return entities;
  }
}

/** Create an empty world. */
export function createWorld() {
  return new World();
}
