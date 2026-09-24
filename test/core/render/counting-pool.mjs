/**
 * A target pool wrapped to count the calls the pass graph makes to it.
 *
 * `created` says how many targets the pool holds; the acquire count says
 * whether the steady path asked for a target at all. A frame that allocates
 * nothing makes no acquire call after its first, whatever the pass set does
 * afterwards. Wrapping rather than editing the pool keeps the pool's own
 * interface unchanged.
 */
import { makeTargetPool } from '../../../engine/render/target-pool.js'

/** Wrap a target pool, counting its acquire and release calls. */
export function makeCountingPool(pool = makeTargetPool()) {
  let acquired = 0
  let released = 0
  return {
    acquire(descriptor) {
      acquired++
      return pool.acquire(descriptor)
    },
    release(target) {
      released++
      return pool.release(target)
    },
    resize(width, height) {
      pool.resize(width, height)
    },
    dispose() {
      pool.dispose()
    },
    recreate() {
      pool.recreate()
    },
    key: pool.key,
    get created() {
      return pool.created
    },
    get acquired() {
      return acquired
    },
    get released() {
      return released
    }
  }
}
