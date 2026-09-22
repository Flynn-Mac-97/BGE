import { defineConfig } from 'vite'
import { engineServerConfig } from './engine/server-config.mjs'

export default defineConfig({
  ...engineServerConfig(),
  build: { target: 'esnext', rollupOptions: { external: [/^node:/] } }
})
