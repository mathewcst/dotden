import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import { config as base } from './base.js'

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
]

export default config
