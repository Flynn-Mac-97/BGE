/**
 * Plugin Master — the rules for creating and editing plugins.
 *
 * The rules live in the sidecar guide, which declares `match: plugins/**
 * project/plugins/**`, so any plugin task carries them. The plugin itself is
 * deliberately bare; commands and tests can be added here like any other.
 */
export default {
  name: 'Plugin Master'
}
