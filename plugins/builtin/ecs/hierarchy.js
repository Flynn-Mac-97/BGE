import { defineComponent } from './component.js';

/**
 * Scene-graph relationship stored on the child: `{ parent: entityHandle }`.
 * Parented entities form a forest, with at most one parent each and no cycles.
 */
export const Parent = defineComponent('Parent');

/**
 * Point `child` at `parent`, or detach when `parent` is null. Throws on a
 * non-live endpoint or when the link would create a cycle. Returns the parent
 * handle that was set, or null after detaching.
 */
export function setParent(world, child, parent) {
  if (!world.isAlive(child)) {
    throw new RangeError('cannot parent a non-live entity');
  }
  if (parent === null) {
    world.removeComponent(child, Parent);
    return null;
  }
  if (!world.isAlive(parent)) {
    throw new RangeError('cannot parent to a non-live entity');
  }
  if (parent === child || isAncestor(world, child, parent)) {
    throw new RangeError('parenting would create a cycle');
  }
  world.addComponent(child, Parent, { parent });
  return parent;
}

/**
 * The live parent handle, or null when the entity is unparented or was orphaned
 * by its parent's destruction.
 */
export function getParent(world, entity) {
  const relationship = world.getComponent(entity, Parent);
  if (relationship === undefined) return null;
  return world.isAlive(relationship.parent) ? relationship.parent : null;
}

/** True when `ancestor` appears on `entity`'s parent chain. */
export function isAncestor(world, ancestor, entity) {
  return ancestorChain(world, entity).includes(ancestor);
}

/** The topmost live ancestor, or the entity itself when it is a root. */
export function rootOf(world, entity) {
  const chain = ancestorChain(world, entity);
  return chain.length === 0 ? entity : chain[chain.length - 1];
}

/** Number of parents above the entity; a root has depth 0. */
export function depthOf(world, entity) {
  return ancestorChain(world, entity).length;
}

/** Direct children of `parent`, in slot order. */
export function childrenOf(world, parent) {
  const children = [];
  for (const entity of world.query([Parent])) {
    if (getParent(world, entity) === parent) children.push(entity);
  }
  return children;
}

/** Every descendant, breadth-first, excluding the starting entity. */
export function descendantsOf(world, root) {
  const found = [];
  const visited = new Set([root]);
  const queue = [root];
  for (let next = 0; next < queue.length; next += 1) {
    for (const child of childrenOf(world, queue[next])) {
      if (visited.has(child)) continue;
      visited.add(child);
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

/** Destroy `entity` and every descendant; returns the number destroyed. */
export function destroySubtree(world, root) {
  if (!world.isAlive(root)) return 0;
  const doomed = [root, ...descendantsOf(world, root)];
  for (let index = doomed.length - 1; index >= 0; index -= 1) {
    world.destroyEntity(doomed[index]);
  }
  return doomed.length;
}

/**
 * Parent handles from the entity upward, nearest first. The visited set bounds
 * the walk if a host writes a Parent cycle directly instead of via setParent.
 */
function ancestorChain(world, entity) {
  const chain = [];
  const visited = new Set([entity]);
  let current = getParent(world, entity);
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = getParent(world, current);
  }
  return chain;
}
