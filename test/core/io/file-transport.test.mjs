/**
 * The transport contract `makeFiles` reads and writes through.
 *
 * `overHTTP` in the browser and `onDisk` in node are two hand-written
 * implementations of one interface, `FileTransport` in `files.js`. A method
 * present on one and missing on the other used to be patched with a guard
 * inside `makeFiles`; this list is what both are held to instead.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { overHTTP } from '../../../engine/files.js'
import { onDisk } from '../../../engine/on-disk.mjs'

/** Every method `makeFiles` calls on its transport. */
const FILE_TRANSPORT_METHODS = [
  'index',
  'tree',
  'agentPlugins',
  'agentInterface',
  'read',
  'sourceCatalog',
  'listDocuments',
  'readDocument',
  'writeDocument',
  'writeSource',
  'readSource',
  'readAgent',
  'write',
  'writeAgent'
]

test('both transports provide every method makeFiles calls', () => {
  for (const [name, transport] of [
    ['overHTTP', overHTTP()],
    ['onDisk', onDisk('.')]
  ]) {
    const missing = FILE_TRANSPORT_METHODS.filter(method => typeof transport[method] !== 'function')
    assert.deepEqual(missing, [], `${name} is missing: ${missing.join(', ')}`)
  }
})
