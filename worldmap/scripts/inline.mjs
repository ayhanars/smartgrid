// Bundles dist/ into one self-contained HTML file (dist/standalone.html) that can be
// dropped into a CMS, an email builder's HTML block, or hosted anywhere as a single file.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dist = new URL('../dist/', import.meta.url)
let html = readFileSync(new URL('index.html', dist), 'utf8')
const assets = join(dist.pathname, 'assets')
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
writeFileSync(new URL('standalone.html', dist), html)
console.log('dist/standalone.html', (html.length / 1024).toFixed(0), 'kB')
