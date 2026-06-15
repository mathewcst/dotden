import astro from 'eslint-plugin-astro'
import { config as base } from './base.js'

export const config = [
  ...base,
  ...astro.configs['flat/recommended'],
]

export default config
