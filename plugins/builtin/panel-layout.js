/** Terminal inspection for the resize handles owned by the shell. */
export default {
  name: 'Panel Layout',

  category: 'editor',
  commands: [
    {
      id: 'layout.read',
      label: 'Read panel sizes',
      run: context => context.shell?.layout() || { screen: false }
    },
    {
      id: 'layout.set',
      label: 'Set panel sizes',
      run: (context, values) => {
        if (!context.shell) return { screen: false }
        return context.shell.setLayout(values || {})
      }
    },
    {
      id: 'layout.reset',
      label: 'Reset panel sizes',
      run: context => context.shell?.resetLayout() || { screen: false }
    }
  ]
}
