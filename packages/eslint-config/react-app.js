import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import { config as base } from './base.js'
import { rendererBoundaries } from './renderer-boundaries.js'

export const config = [
  ...base,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  // Renderer layer-boundary gate (ADR 0033/0035/0036). `files`-scoped to
  // `src/renderer/**`, so inert for any non-renderer consumer of this config.
  rendererBoundaries,
  // shadcn CLI-owned vendor files — the vanilla `components/ui/**` primitives and the
  // shipped `use-mobile` hook — are never hand-edited (ADR 0036 keeps them
  // `shadcn add`-upgradeable), so their internal patterns aren't ours to "fix". Exempt
  // them from `react-hooks/set-state-in-effect` config-side rather than inline-disable
  // code the next `shadcn add` would overwrite. Must sit AFTER the react-hooks recommended
  // config above to override it. (Our OWN renderer code stays fully gated by the rule.)
  {
    files: ['src/renderer/components/ui/**', 'src/renderer/hooks/use-mobile.ts'],
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
]

export default config
