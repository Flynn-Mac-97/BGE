/**
 * Create a component type token. The token is the identity used to store and
 * query component values; define each type once and import it everywhere.
 * Two calls with the same name yield two distinct types, so unrelated plugins
 * cannot collide by choosing the same label.
 */
export function defineComponent(name) {
  return Object.freeze({ name });
}
