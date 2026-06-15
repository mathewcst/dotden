import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import turbo from 'eslint-plugin-turbo'
import tseslint from 'typescript-eslint'

export const config = tseslint.config(
  {
    ignores: ['out/**', 'dist/**', '.astro/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      turbo,
    },
    rules: {
      'turbo/no-undeclared-env-vars': 'warn',
    },
  },
  prettier,
)

export default config
