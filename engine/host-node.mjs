/**
 * Kernel: what a plugin can only do when the world runs in node.
 *
 * Two things the browser half cannot give a plugin: the project's real
 * directory, and running a program. A plugin that needs an outside tool — a
 * modeller, an encoder, a converter — asks `context.host` for both, and finds
 * it `null` in the browser, which is the signal to answer with the terminal
 * command instead of failing halfway.
 *
 * It grants no new power. A plugin running in node can already import
 * `node:child_process`. It exists so every such plugin spawns the same way and
 * reads the same paths, rather than each one re-deriving where the project is.
 */
import { spawn } from 'node:child_process'

/** How much of a program's output is kept. Enough to read a failure by. */
const KEEP = 20000

/**
 * Run a program and wait for it.
 *
 * No shell: arguments are passed as a list, so a path with a space or a
 * quote is one argument and never a second command. A program that fails is
 * reported by its code and its output, not thrown — a caller usually wants to
 * show the tool's own message.
 */
function runProgram(command, args = [], { cwd, timeout = 600000, input } = {}) {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(command, args, { cwd, windowsHide: true })
    } catch (error) {
      resolve({ code: null, out: '', error: String(error?.message || error) })
      return
    }
    let out = '',
      error = ''
    /** Append output, keeping only the last KEEP characters so a chatty tool cannot exhaust memory. */
    const keep = (text, into) => (into + text).slice(-KEEP)
    child.stdout?.on('data', chunk => {
      out = keep(String(chunk), out)
    })
    child.stderr?.on('data', chunk => {
      error = keep(String(chunk), error)
    })
    if (input != null) {
      child.stdin?.write(input)
      child.stdin?.end()
    }

    const timer = setTimeout(() => {
      child.kill()
      error = keep(`\ntimed out after ${timeout} ms`, error)
    }, timeout)
    child.on('error', failure => {
      clearTimeout(timer)
      resolve({ code: null, out, error: String(failure?.message || failure) })
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, out, error })
    })
  })
}

/**
 * The host a node world hands its plugins.
 *
 * `project` and `checkout` are absolute. Everywhere else in the engine a
 * project file is named `project/<path>`, because the dev server maps that URL
 * onto any directory; an outside program needs the directory itself.
 */
export function makeHost({ project, checkout }) {
  return { project, checkout, run: runProgram }
}
