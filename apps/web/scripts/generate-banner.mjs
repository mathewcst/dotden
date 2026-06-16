// Generates the README hero banner (docs/design-system/assets/banner.png, plus
// a 2x export), replacing the older off-brand SVG.
//
// A run-by-hand one-off — re-run when the brand or tagline changes:
//
//     node scripts/generate-banner.mjs
//
// We emit a PNG (not SVG) on purpose: GitHub strips/sanitises custom fonts from
// inline SVG, so an SVG banner would lose Geist and render off-brand. Baking the
// type into a raster keeps it faithful. Shares lib/brand.mjs with the OG card so
// the two stay a family. Geist must be visible to fontconfig (see lib/brand.mjs).

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { TOKENS, gridLayer, markGlyph, renderScales } from './lib/brand.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(__dirname, '..', '..', '..', 'docs', 'design-system', 'assets')

// 1x for the README; 2x as a crisp re-usable export.
const SCALES = [1, 2]

// Same 1280×380 frame as the banner it replaces, so README layout is unchanged.
const W = 1280
const H = 380
const R = 16 // rounded-card corners
const CX = W / 2
const { ink950, ink100, ink400, ember } = TOKENS

const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="dotden — your environment, anywhere.">
  <defs>
    <clipPath id="card"><rect width="${W}" height="${H}" rx="${R}"/></clipPath>
  </defs>

  <!-- everything clipped to a rounded card; corners stay transparent so the
       banner reads on both light and dark README themes -->
  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="${ink950}"/>
    ${gridLayer({ w: W, h: H, cx: '50%', cy: '34%', r: '78%' })}

    <!-- centred wordmark -->
    <g transform="translate(${CX - 68}, 70)">
      ${markGlyph(34)}
      <text x="48" y="25" font-family="Geist" font-weight="600" font-size="26" fill="${ink100}" letter-spacing="-0.4">dotden</text>
    </g>

    <!-- headline -->
    <text x="${CX}" y="218" text-anchor="middle" font-family="Geist" font-weight="600" font-size="62" letter-spacing="-2.4" fill="${ink100}">your environment, <tspan fill="${ember}">anywhere</tspan>.</text>

    <!-- subhead -->
    <text x="${CX}" y="270" text-anchor="middle" font-family="Geist" font-weight="400" font-size="22" letter-spacing="-0.2" fill="${ink400}">Dotfiles, configs, and preferences — synced across every machine you work on.</text>

    <!-- mono caption -->
    <text x="${CX}" y="326" text-anchor="middle" font-family="Geist Mono" font-weight="500" font-size="17" letter-spacing="0.4" fill="${ink400}">Open source · macOS · Linux · Windows</text>
  </g>

  <!-- hairline frame on the rounded card -->
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${R}" fill="none" stroke="${ink100}" stroke-opacity="0.08"/>
</svg>`

const files = await renderScales({ svg, scales: SCALES, dir: ASSETS, basename: 'banner' })
for (const f of files) console.log(`wrote ${f}`)
