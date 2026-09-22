/**
 * Define a system: a named unit of behavior. `run` receives the world and a
 * host-supplied frame record (for example `{ deltaSeconds }`), and mutates the
 * world through its public API.
 */
export function defineSystem(name, run) {
  return Object.freeze({ name, run });
}

/**
 * Run systems in array order. The array is the schedule: ordering is explicit
 * and deterministic, with no hidden priority field. The frame record is passed
 * through untouched, so the host decides what a frame contains.
 */
export function runSchedule(systems, world, frame) {
  for (const system of systems) {
    system.run(world, frame);
  }
}
