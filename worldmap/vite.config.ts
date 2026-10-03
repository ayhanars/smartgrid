import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Two pages: index.html (the map) and bubbles.html (World in Bubbles).
// Set VITE_BASE when the site is served from a sub-path (e.g. "/worldmap/" on GitHub Pages).
// PAGE=<file.html> builds one page on its own (used by scripts/inline.mjs).
const pages = process.env.PAGE ? [process.env.PAGE] : ['index.html', 'bubbles.html']

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  build: {
    target: 'es2022',
    outDir: process.env.OUT_DIR || 'dist',
    rollupOptions: {
      input: Object.fromEntries(pages.map((p) => [p.replace(/\.html$/, ''), resolve(__dirname, p)])),
    },
  },
})
