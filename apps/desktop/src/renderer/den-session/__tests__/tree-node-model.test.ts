import { describe, expect, it } from 'vitest'
import { buildWorkspaceTreeModel } from '../tree-node-model'
import type { FileTreeEntry } from '@shared/den'
import type { Group, Workspace } from '@shared/workspace'

function group(id: string, label: string, parentId: string | null = null): Group {
  return { id, label, parentId, scope: null }
}

function file(targetPath: string, workspaceId: string, groupId: string | null): FileTreeEntry {
  return { targetPath, workspaceId, groupId, status: null, muted: false, scope: null }
}

function workspace(id: string, label: string, groups: readonly Group[]): Workspace {
  return { id, label, groups, scope: null }
}

function childNames(model: ReturnType<typeof buildWorkspaceTreeModel>, parentName: string) {
  const parent = [...model.nodes.values()].find((node) => node.name === parentName)
  expect(parent, `missing node ${parentName}`).toBeTruthy()
  return (model.childrenById.get(parent!.id) ?? []).map((id) => model.nodes.get(id)?.name)
}

describe('buildWorkspaceTreeModel', () => {
  it('nests Groups, nests Files by real path inside each bucket, and keeps duplicate folders contextual', () => {
    const workspaces = [
      workspace('personal', 'Personal', [
        group('editors', 'Editors'),
        group('vim', 'Vim', 'editors'),
        group('shell', 'Shell'),
      ]),
    ]
    const model = buildWorkspaceTreeModel({
      workspaces,
      files: [
        file('.zshrc', 'personal', null),
        file('.config/nvim/init.lua', 'personal', 'vim'),
        file('.config/nvim/lua/plugins.lua', 'personal', 'vim'),
        file('.config/nvim/README.md', 'personal', 'shell'),
      ],
    })

    expect(childNames(model, 'Personal')).toEqual(['Editors', 'Shell', '.zshrc'])
    expect(childNames(model, 'Editors')).toEqual(['Vim'])
    expect(childNames(model, 'Vim')).toEqual(['.config'])
    expect(childNames(model, 'Shell')).toEqual(['.config'])

    const configFolders = [...model.nodes.values()].filter(
      (node) => node.kind === 'folder' && node.name === '.config',
    )
    expect(configFolders).toHaveLength(2)
  })

  it('places an ungrouped root File directly under its Workspace', () => {
    const model = buildWorkspaceTreeModel({
      workspaces: [workspace('personal', 'Personal', [])],
      files: [file('.gitconfig', 'personal', null)],
    })

    expect(childNames(model, 'Personal')).toEqual(['.gitconfig'])
  })
})
