/**
 * Kernel: the renderer's one history of messages already said.
 *
 * Every part of the renderer reports through here, so a message is printed once
 * whatever part raised it. `forget` clears the history, so a message about a
 * file that has been edited and fixed can be said again.
 */
import { makeOnceReporter } from '../report-once.js'

export const { report: reportOnce, clearSaid: clearReported } = makeOnceReporter()
