// Shared brand primitives for the generated brand images (OG card, README
// banner). Keeping the tokens, grid texture, and rasteriser in one place means
// every exported asset stays a visual family — flat near-black canvas, faint
// engineering grid, ember accent — and mirrors src/styles/global.css.
//
// Text in these assets renders in Geist, so make the Geist family visible to
// fontconfig before running a generator (copy the @fontsource-variable/geist
// woff2 files into ~/.fonts and `fc-cache`).

import sharp from 'sharp'

/** Brand tokens, mirrored from src/styles/global.css. */
export const TOKENS = {
  ink950: '#100E0B', // page background
  ink990: '#1A1208', // tinted mark center
  ink100: '#E7E0D5', // foreground
  ink400: '#82766A', // muted text
  ink700: '#322C25', // borders
  ember: '#E76A33', // primary
}

/**
 * A faint 56px grid, faded toward transparency by a radial mask — the same
 * `.bg-grid` device the site uses. Returns an SVG fragment (a <defs> + masked
 * <g> of lines); pass a unique `id` if you place more than one per document.
 */
export function gridLayer({ w, h, id = 'grid', cx = '22%', cy = '36%', r = '85%', step = 56 }) {
  let lines = ''
  for (let x = step; x < w; x += step) lines += `<line x1="${x}" y1="0" x2="${x}" y2="${h}"/>`
  for (let y = step; y < h; y += step) lines += `<line x1="0" y1="${y}" x2="${w}" y2="${y}"/>`
  return `
    <defs>
      <radialGradient id="${id}Fade" cx="${cx}" cy="${cy}" r="${r}">
        <stop offset="0%" stop-color="white" stop-opacity="1"/>
        <stop offset="70%" stop-color="white" stop-opacity="0"/>
      </radialGradient>
      <mask id="${id}Mask"><rect width="${w}" height="${h}" fill="url(#${id}Fade)"/></mask>
    </defs>
    <g stroke="${TOKENS.ink100}" stroke-opacity="0.05" stroke-width="1" mask="url(#${id}Mask)">
      ${lines}
    </g>`
}

/**
 * The ember wordmark mark (rounded square + inset dot), drawn as pure shapes so
 * it needs no font. `size` is the square's side in px.
 */
export function markGlyph(size = 40) {
  const r = size * 0.275
  const dot = size * 0.1625
  return `<rect width="${size}" height="${size}" rx="${r}" fill="${TOKENS.ember}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${dot}" fill="${TOKENS.ink990}"/>`
}

/**
 * Rasterise one SVG string to PNG at each scale. The source is vector, so each
 * scale is re-rendered at a higher DPI (crisp), never upscaled. Writes
 * `<basename>.png` at 1x and `<basename>@Nx.png` for the rest.
 */
export async function renderScales({ svg, scales, dir, basename }) {
  const { join } = await import('node:path')
  const written = []
  for (const scale of scales) {
    const file = join(dir, scale === 1 ? `${basename}.png` : `${basename}@${scale}x.png`)
    await sharp(Buffer.from(svg), { density: 72 * scale })
      .png()
      .toFile(file)
    written.push(file)
  }
  return written
}
