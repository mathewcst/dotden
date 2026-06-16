// Generates the social-share / Open Graph image (public/og.png, 1200×630).
//
// It's a one-off, run-by-hand script — not part of `astro build` — because the
// OG image only changes when the brand or tagline does. Re-run it with:
//
//     node scripts/generate-og.mjs
//
// The image mirrors the site: flat near-black canvas, a faint engineering grid,
// the ember wordmark, the headline, and a mono caption. It's drawn as a single
// SVG and rasterised with Sharp (the same dependency astro:assets already uses).
// Text is rendered in Geist — make sure the Geist family is visible to
// fontconfig before running (the @fontsource-variable/geist woff2 files work
// once copied into ~/.fonts and `fc-cache`'d).

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'public', 'og.png')

const W = 1200
const H = 630

// brand tokens, mirrored from src/styles/global.css
const INK_950 = '#100E0B'
const INK_100 = '#E7E0D5'
const INK_400 = '#82766A'
const INK_700 = '#322C25'
const EMBER = '#E76A33'
const INK_990 = '#1A1208'

// 56px grid, faded toward the edges via a radial mask — same as .bg-grid
const gridLines = () => {
  let lines = ''
  for (let x = 56; x < W; x += 56) lines += `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`
  for (let y = 56; y < H; y += 56) lines += `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`
  return lines
}

const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="gridFade" cx="22%" cy="36%" r="85%">
      <stop offset="0%" stop-color="white" stop-opacity="1"/>
      <stop offset="70%" stop-color="white" stop-opacity="0"/>
    </radialGradient>
    <mask id="gridMask"><rect width="${W}" height="${H}" fill="url(#gridFade)"/></mask>
  </defs>

  <rect width="${W}" height="${H}" fill="${INK_950}"/>
  <g stroke="${INK_100}" stroke-opacity="0.05" stroke-width="1" mask="url(#gridMask)">
    ${gridLines()}
  </g>

  <!-- wordmark -->
  <g transform="translate(80, 78)">
    <rect width="40" height="40" rx="11" fill="${EMBER}"/>
    <circle cx="20" cy="20" r="6.5" fill="${INK_990}"/>
    <text x="58" y="29" font-family="Geist" font-weight="600" font-size="30" fill="${INK_100}" letter-spacing="-0.5">dotden</text>
  </g>

  <!-- headline -->
  <g font-family="Geist" font-weight="600" font-size="68" letter-spacing="-2.6">
    <text x="78" y="312" fill="${INK_100}">Make yourself at home</text>
    <text x="78" y="392" fill="${INK_100}">in <tspan fill="${EMBER}">any environment</tspan>.</text>
  </g>

  <!-- subhead -->
  <text x="80" y="466" font-family="Geist" font-weight="400" font-size="27" fill="${INK_400}" letter-spacing="-0.3">Your dotfiles &amp; configs, synced across every computer — no command line.</text>

  <!-- mono caption -->
  <g transform="translate(80, 540)">
    <rect x="0" y="-15" width="9" height="9" rx="4.5" fill="${EMBER}"/>
    <text x="22" y="-6" font-family="Geist Mono" font-weight="500" font-size="20" fill="${INK_400}" letter-spacing="0.5">Open source · macOS · Linux · Windows</text>
  </g>

  <!-- hairline frame -->
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${INK_700}" stroke-opacity="0.6"/>
</svg>`

await sharp(Buffer.from(svg)).png().toFile(OUT)
console.log(`wrote ${OUT}`)
