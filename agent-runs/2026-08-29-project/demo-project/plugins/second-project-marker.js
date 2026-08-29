/**
 * A project plugin that exists nowhere else.
 *
 * It proves the second half of the change: project plugins are listed from the
 * project tree now instead of being expanded by a Vite glob, so a world opened
 * on THIS directory loads THIS project's plugins and not the other project's.
 */
export default {
  name: 'Second Project Marker',
  commands: [{
    id: 'second-project.marker',
    label: 'Prove which project loaded this plugin',
    run: context => ({ from: 'demo-project', title: context.editor.projectName })
  }]
}
