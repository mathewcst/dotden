import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import turbo from 'eslint-plugin-turbo'
import tseslint from 'typescript-eslint'

export const config = tseslint.config(
  {
    ignores: ['out/**', 'dist/**', '.astro/**', 'node_modules/**'],
  },
  {
    // Point #5 teeth, zero extra package: a `// eslint-disable` that no longer
    // suppresses anything becomes an error, so stale suppressions can't rot in
    // the tree. "Every live disable carries an inline `-- reason`" stays a
    // review convention (see CONVENTIONS.md), not a plugin.
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
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
