/**
 * Kernel: the interface reader a plugin provides, when that plugin is present.
 *
 * Plugin Master owns the interface block and the source parser behind it, so the
 * kernel reaches it lazily and by path, only when a packet or a server route asks
 * for an interface. A checkout without that directory still boots and still
 * loads the CLI; the packets it builds carry the guide prose alone.
 *
 * Node only, like the plugin it reads.
 */

/**
 * The reader for one checkout and project, or null when Plugin Master is absent.
 *
 * @param {object} places `root` is the checkout, `projectDirectory` the open game.
 * @returns {Promise<Function|null>} `(scope, file)`, or null.
 */
export async function pluginInterfaceReader({ root, projectDirectory }) {
  try {
    const { makeInterfaceReader } = await import('../plugins/builtin/plugin-master/interface-block.js')
    return makeInterfaceReader({ root, projectDirectory })
  } catch (error) {
    // A missing plugin is not a fault: the kernel does not own the parser. Any
    // other failure is a real fault and must not be swallowed.
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
    return null
  }
}
