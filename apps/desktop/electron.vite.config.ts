import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig(async ({ mode }) => {
  // electron-vite only exposes prefixed env vars by default, and the main process
  // runtime reads DOTDEN_* from process.env for local binary overrides. Load the
  // desktop app's .env.local/.env files here and copy only those explicit dev
  // overrides into the Electron child process environment. Packaged builds still
  // resolve binaries from process.resourcesPath; this is just the local-dev escape hatch.
  Object.assign(process.env, loadEnv(mode, __dirname, ['DOTDEN_']))

  const reactCompiler = await babel({ presets: [reactCompilerPreset()] })

  return {
    // electron-vite v5 externalizes deps via build.externalizeDeps (enabled by
    // default), so the old externalizeDepsPlugin is no longer needed.
    main: {},
    preload: {},
    renderer: {
      root: 'src/renderer',
      base: './',
      resolve: {
        alias: [
          { find: '@', replacement: resolve(__dirname, 'src/renderer') },
          // `@shared/*` → the cross-process IPC contract (`src/shared`): types + pure
          // helpers shared by main and renderer. Distinct from `@/shared`
          // (renderer-internal). The renderer reaches the contract ONLY through this
          // alias and must never deep-import `../../main/**` (ADR 0031). Safe to place
          // after `@`: rollup string aliases require a `/` boundary, so `@` never
          // swallows `@shared/…`.
          { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
          // Trim Shiki to dotden's config languages (issue 1-07): `@pierre/diffs`
          // imports `bundledLanguages` from the bare `shiki` specifier, which is a
          // map of ~330 lazy grammar imports — Rollup can't tree-shake it, so the
          // build emits a chunk per grammar. This shim re-exports real Shiki but
          // overrides `bundledLanguages` with only the config-language grammars.
          // The `^shiki$` anchor matches ONLY the bare specifier, so the shim's own
          // `shiki/dist/index.mjs` re-export (a subpath) is left untouched.
          {
            find: /^shiki$/,
            replacement: resolve(__dirname, 'src/renderer/vendor/shiki-config-langs.mjs'),
          },
        ],
      },
      plugins: [react({}), reactCompiler, tailwindcss()],
      build: { outDir: 'out/renderer', sourcemap: true },
    },
  }
})
