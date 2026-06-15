import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig(async () => {
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
