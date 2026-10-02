import { defineConfig } from 'vite'

// Set VITE_BASE when the site is served from a sub-path (e.g. "/worldmap/" on GitHub Pages).
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  build: { target: 'es2022' },
})
