import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
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
    main: { plugins: [externalizeDepsPlugin()] },
    preload: { plugins: [externalizeDepsPlugin()] },
    renderer: {
      root: 'src/renderer',
      base: './',
      resolve: { alias: { '@': resolve(__dirname, 'src/renderer') } },
      plugins: [react({}), reactCompiler, tailwindcss()],
      build: { outDir: 'out/renderer', sourcemap: true },
    },
  }
})
