import { startDesktop } from './desktop.mjs'
import { app, dialog } from 'electron'

startDesktop().catch(error => {
  console.error(error)
  dialog.showErrorBox('Engine could not start', error.message)
  app.exit(1)
})
