export async function captureEditor(options = {}) {
  if (typeof window === 'undefined') return { error: 'see.editor needs the desktop engine; it cannot capture a headless world' }
  const client = new URLSearchParams(window.location.search).get('client')
  const query = new URLSearchParams({ scope: options.scope || 'editor', name: options.name || 'editor', client: client || '' })
  const response = await fetch('/api/desktop/capture?' + query)
  if (response.status === 404) return { error: 'see.editor needs the updated desktop host; restart the desktop engine after building' }
  return response.json()
}
