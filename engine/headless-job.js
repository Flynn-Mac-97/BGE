/**
 * Run an engine command in a headless engine from the page, and wait for its
 * answer. For a command that must start a program, which a page cannot do.
 * The server half is `engine/headless-jobs.mjs`; the route is `/api/headless-job`.
 */
import { clientName } from './files.js'

const POLL_MILLISECONDS = 2000

/** JSON from a job route, or an Error with the server's reason. */
async function jobRequest(url, options) {
  const response = await fetch(url, options)
  const body = await response.json()
  if (!response.ok || body.error) throw new Error(body.error || response.statusText)
  return body
}

/**
 * Run `command` with `options` headless. Resolves with the command's answer,
 * and rejects with the end of its output when it fails. `onRunning(job)` is
 * called once the job has started.
 */
export async function runHeadless(command, options = {}, onRunning = () => {}) {
  const { job } = await jobRequest('/api/headless-job', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-engine-client': clientName() },
    body: JSON.stringify({ command, options })
  })
  onRunning(job)
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, POLL_MILLISECONDS))
    const found = await jobRequest(`/api/headless-job?job=${encodeURIComponent(job)}`)
    if (found.state === 'done') return found.answer
    if (found.state === 'failed') throw new Error(found.error)
  }
}
