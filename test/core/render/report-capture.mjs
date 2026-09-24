/**
 * Capture what the kernel writes to `console.error` while `run` runs, so a test
 * can check the message a refused value produced instead of the value alone.
 */
export function captureConsoleError(run) {
  const said = []
  const original = console.error
  console.error = message => said.push(String(message))
  try {
    run()
  } finally {
    console.error = original
  }
  return said
}
