import { defineConfig } from 'vite'
import { fileURLToPath } from 'url'

// Marketing site: a fake desktop with a live Just a txt window (reuses the app's editor).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5180 }
})
