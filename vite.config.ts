import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    // `/smartgrid/` for the GitHub Pages project site; set VITE_BASE=/ once
    // the app is served from a custom domain.
    base: env.VITE_BASE || '/smartgrid/',
    plugins: [react()],
  }
})
