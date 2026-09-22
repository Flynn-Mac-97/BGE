// The desktop owns the console so reloading a game cannot close its terminals.
export default {
  name: 'Console',
  category: 'editor',
  about: 'Read the desktop instance list through the engine command surface.',
  commands: [{
    id: 'console.instances',
    label: 'List desktop instances',
    async run() {
      if (typeof window === 'undefined') return { supported: false, instances: [] }
      const response = await fetch('/api/desktop')
      if (!response.ok) throw new Error(`Desktop listing failed: ${response.status}`)
      return response.json()
    }
  }]
}
