import { entitySlotIndex } from './entity-id.js';

/**
 * Entity handles carrying every component type in the list, in ascending slot
 * order. Iterates the smallest store, so cost tracks the narrowest component
 * rather than the world size. The result is a fresh array: callers may add,
 * remove, or destroy while iterating a previous result.
 *
 * Returns [] when the list is empty or names a component no entity has yet.
 */
export function matchEntities(componentStores, componentTypes) {
  if (componentTypes.length === 0) return [];
  const stores = componentTypes.map((type) => componentStores.get(type));
  if (stores.some((store) => store === undefined)) return [];
  const smallest = smallestStore(stores);
  const matches = [];
  for (const entity of smallest.keys()) {
    if (isInEveryStore(entity, stores, smallest)) matches.push(entity);
  }
  matches.sort((left, right) => entitySlotIndex(left) - entitySlotIndex(right));
  return matches;
}

function smallestStore(stores) {
  let smallest = stores[0];
  for (const store of stores) {
    if (store.size < smallest.size) smallest = store;
  }
  return smallest;
}

// The smallest store's own key is trivially present; skipping it saves a lookup.
function isInEveryStore(entity, stores, smallest) {
  return stores.every((store) => store === smallest || store.has(entity));
}
