// Builds one page on its own and bundles it into a single self-contained HTML file
// that can be dropped into a CMS, an HTML block, or hosted anywhere as one file.
//   node scripts/inline.mjs            -> dist/index.standalone.html
//   node scripts/inline.mjs bubbles.html -> dist/jelly.standalone.html
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const page = process.argv[2] || 'index.html'
const root = new URL('..', import.meta.url).pathname
const tmp = join(root, '.single')
rmSync(tmp, { recursive: true, force: true })
execSync('npx vite build', { cwd: root, stdio: 'inherit', env: { ...process.env, PAGE: page, OUT_DIR: '.single' } })

let html = readFileSync(join(tmp, page), 'utf8')
const assets = join(tmp, 'assets')
for (const file of readdirSync(assets)) {
  const content = readFileSync(join(assets, file), 'utf8')
  if (file.endsWith('.js')) {
    html = html.replace(
      new RegExp(`<script[^>]*src="[^"]*${file}"[^>]*></script>`),
      () => `<script type="module">${content.replace(/<\/script/g, '<\\/script')}</script>`,
    )
  } else if (file.endsWith('.css')) {
    html = html.replace(new RegExp(`<link[^>]*href="[^"]*${file}"[^>]*>`), () => `<style>${content}</style>`)
  }
}
html = html.replace(/<link rel="modulepreload"[^>]*>/g, '')
mkdirSync(join(root, 'dist'), { recursive: true })
const out = join(root, 'dist', page.replace(/\.html$/, '.standalone.html'))
writeFileSync(out, html)
rmSync(tmp, { recursive: true, force: true })
console.log(out.replace(root, ''), (html.length / 1024).toFixed(0), 'kB')
