import { config } from '@dotden/eslint-config/astro'

export default [
  ...config,
  {
    // One-off Node build scripts (e.g. OG-image generation) run under Node, not
    // the browser/Astro runtime — give them the Node globals.
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: { Buffer: 'readonly', process: 'readonly', console: 'readonly' },
    },
  },
]
