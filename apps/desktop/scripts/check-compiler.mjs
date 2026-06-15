import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rendererOut = fileURLToPath(new URL('../out/renderer/', import.meta.url))

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile() && entry.name.endsWith('.js')) yield path
  }
}

let checked = 0
let compilerHit = false

for await (const file of walk(rendererOut)) {
  checked += 1
  const contents = await readFile(file, 'utf8')
  if (contents.includes('_c(') || contents.includes('react/compiler-runtime')) {
    compilerHit = true
    break
  }
}

if (!compilerHit) {
  console.error(
    `React Compiler validation failed: checked ${checked} renderer JS files and found no _c( cache slots or react/compiler-runtime import.`,
  )
  process.exit(1)
}

console.log('React Compiler validation passed: found compiled cache slots in renderer bundle.')
