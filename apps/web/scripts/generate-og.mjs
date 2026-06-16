// Generates the social-share / Open Graph image (public/og.png, 1200×630) plus
// crisp 2x/4x re-usable exports.
//
// It's a one-off, run-by-hand script — not part of `astro build` — because the
// OG image only changes when the brand or tagline does. Re-run it with:
//
//     node scripts/generate-og.mjs
//
// Shared brand primitives (tokens, grid, mark, rasteriser) live in lib/brand.mjs
// so this card and the README banner stay a visual family. Text renders in Geist
// — make the family visible to fontconfig first (see lib/brand.mjs).

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { TOKENS, gridLayer, markGlyph, renderScales } from './lib/brand.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(__dirname, '..', 'public')

// 1x is the og:image the site references; 2x/4x are bigger exports for places
// that want a larger asset (GitHub social preview, slides, READMEs).
const SCALES = [1, 2, 4]

const W = 1200
const H = 630
const { ink950, ink100, ink400, ink700, ember } = TOKENS

const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${ink950}"/>
  ${gridLayer({ w: W, h: H })}

  <!-- wordmark -->
  <g transform="translate(80, 78)">
    ${markGlyph(40)}
    <text x="58" y="29" font-family="Geist" font-weight="600" font-size="30" fill="${ink100}" letter-spacing="-0.5">dotden</text>
  </g>

  <!-- headline -->
  <g font-family="Geist" font-weight="600" font-size="68" letter-spacing="-2.6">
    <text x="78" y="312" fill="${ink100}">Make yourself at home</text>
    <text x="78" y="392" fill="${ink100}">in <tspan fill="${ember}">any environment</tspan>.</text>
  </g>

  <!-- subhead -->
  <text x="80" y="466" font-family="Geist" font-weight="400" font-size="27" fill="${ink400}" letter-spacing="-0.3">Your dotfiles &amp; configs, synced across every computer — no command line.</text>

  <!-- mono caption -->
  <g transform="translate(80, 540)">
    <rect x="0" y="-15" width="9" height="9" rx="4.5" fill="${ember}"/>
    <text x="22" y="-6" font-family="Geist Mono" font-weight="500" font-size="20" fill="${ink400}" letter-spacing="0.5">Open source · macOS · Linux · Windows</text>
  </g>

  <!-- hairline frame -->
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${ink700}" stroke-opacity="0.6"/>
</svg>`

const files = await renderScales({ svg, scales: SCALES, dir: PUBLIC, basename: 'og' })
for (const f of files) console.log(`wrote ${f}`)
