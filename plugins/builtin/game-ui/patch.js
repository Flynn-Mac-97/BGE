/**
 * Game UI patch: write new HTML into a panel and keep every node that did not change.
 *
 * Replacing the whole panel every time its HTML changes would drop a text
 * input's focus and end a slider drag, because the element under the pointer is
 * new. So the new HTML is parsed aside and walked against what is on the page:
 * a node of the same kind is updated in place, a different one is replaced.
 * Browser only.
 */

const FORM_TAGS = new Set(['INPUT', 'SELECT'])

/**
 * Make `container`'s children equal to the nodes of `html`. `root` is the
 * shadow root that holds it, which knows which control has the focus.
 */
export function patchInto(container, html, root = container) {
  const template = document.createElement('template')
  template.innerHTML = html
  patchChildren(container, template.content, root)
}

function patchChildren(parent, source, root) {
  const wanted = [...source.childNodes]
  const current = [...parent.childNodes]
  for (const [index, node] of wanted.entries()) {
    const existing = current[index]
    if (!existing) { parent.append(node); continue }
    if (existing.nodeName !== node.nodeName) { existing.replaceWith(node); continue }
    patchNode(existing, node, root)
  }
  for (const stale of current.slice(wanted.length)) stale.remove()
}

function patchNode(existing, node, root) {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    if (existing.nodeValue !== node.nodeValue) existing.nodeValue = node.nodeValue
    return
  }
  patchAttributes(existing, node)
  patchChildren(existing, node, root)
  // A control the person is using keeps what they set; the game's value reaches it when they let go.
  if (FORM_TAGS.has(existing.tagName) && existing !== root.activeElement) patchFormState(existing, node)
}

function patchAttributes(existing, node) {
  for (const { name } of [...existing.attributes]) if (!node.hasAttribute(name)) existing.removeAttribute(name)
  for (const { name, value } of node.attributes) if (existing.getAttribute(name) !== value) existing.setAttribute(name, value)
}

/** The live `value` and `checked` do not follow their attributes once a person has edited them. */
function patchFormState(existing, node) {
  existing.checked = node.hasAttribute('checked')
  existing.value = existing.tagName === 'SELECT' ? node.value : node.getAttribute('value') ?? ''
}
