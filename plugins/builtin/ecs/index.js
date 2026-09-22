/** Public surface of the ECS library: world, components, systems, hierarchy. */
export { defineComponent } from './component.js';
export { createWorld } from './world.js';
export { defineSystem, runSchedule } from './system.js';
export {
  Parent,
  childrenOf,
  depthOf,
  descendantsOf,
  destroySubtree,
  getParent,
  isAncestor,
  rootOf,
  setParent,
} from './hierarchy.js';
