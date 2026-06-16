import { describe, expect, it } from 'vitest'
import { resolveContainedPath } from '../path-safety.js'

describe('resolveContainedPath', () => {
  it('resolves a destination-relative File under the root', () => {
    expect(resolveContainedPath('/home/alice', '.config/nvim/init.lua')).toBe(
      '/home/alice/.config/nvim/init.lua',
    )
  })

  it('rejects absolute paths', () => {
    expect(() => resolveContainedPath('/home/alice', '/etc/passwd')).toThrow(/absolute/)
  })

  it('rejects traversal outside the root', () => {
    expect(() => resolveContainedPath('/home/alice', '../.ssh/id_rsa')).toThrow(/outside/)
  })

  it('rejects the root itself because dotden verbs act on Files', () => {
    expect(() => resolveContainedPath('/home/alice', '.')).toThrow(/outside|empty/)
  })
})
