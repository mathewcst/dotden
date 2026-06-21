import type { IncomingReviewItem, RemoteAxisMarker, FileTreeEntry } from '@shared/den'
import type { Group, Workspace } from '@shared/workspace'

export type DotdenTreeNodeKind = 'root' | 'workspace' | 'group' | 'folder' | 'file'

export interface DotdenTreeNode {
  readonly id: string
  readonly kind: DotdenTreeNodeKind
  readonly name: string
  readonly targetPath?: string
  readonly workspaceId?: string
  readonly groupId?: string | null
  readonly file?: FileTreeEntry
  readonly incoming?: IncomingReviewItem
  readonly remoteMarker?: RemoteAxisMarker
}

export interface DotdenTreeModel {
  readonly rootId: string
  readonly nodes: ReadonlyMap<string, DotdenTreeNode>
  readonly childrenById: ReadonlyMap<string, readonly string[]>
  readonly expandedIds: readonly string[]
}

interface BuildWorkspaceTreeInput {
  readonly workspaces: readonly Workspace[]
  readonly files: readonly FileTreeEntry[]
  readonly remoteAxis?: ReadonlyMap<string, RemoteAxisMarker>
}

interface MutableTreeModel {
  readonly nodes: Map<string, DotdenTreeNode>
  readonly childrenById: Map<string, string[]>
  readonly expandedIds: Set<string>
}

const ROOT_ID = 'root'

/**
 * Build the tree data Headless Tree renders in env A.
 *
 * This is the Groups-over-real-folders model from ADR 0032: Workspaces and Groups are user
 * organization, while Folder nodes are contextual reflections of a File's real target path inside
 * the Workspace/Group bucket that owns that File. Folder ids include their containing bucket, so
 * splitting `.config/nvim/` across two Groups naturally creates two separate Folder subtrees.
 */
export function buildWorkspaceTreeModel({
  workspaces,
  files,
  remoteAxis = new Map(),
}: BuildWorkspaceTreeInput): DotdenTreeModel {
  const model: MutableTreeModel = {
    nodes: new Map([[ROOT_ID, { id: ROOT_ID, kind: 'root', name: 'root' }]]),
    childrenById: new Map([[ROOT_ID, []]]),
    expandedIds: new Set([ROOT_ID]),
  }

  const filesByBucket = bucketFilesByWorkspaceAndGroup(files)

  for (const workspace of workspaces) {
    const workspaceId = nodeId('workspace', workspace.id)
    addNode(model, ROOT_ID, {
      id: workspaceId,
      kind: 'workspace',
      name: workspace.label,
      workspaceId: workspace.id,
    })
    model.expandedIds.add(workspaceId)

    const groupsByParent = bucketGroupsByParent(workspace.groups)
    appendGroupChildren(
      model,
      workspace,
      workspaceId,
      null,
      groupsByParent,
      filesByBucket,
      remoteAxis,
    )
    appendFilesByRealPath(
      model,
      workspaceId,
      filesByBucket.get(bucketKey(workspace.id, null)) ?? [],
      remoteAxis,
    )
  }

  return freezeModel(model)
}

/** Build the read-only env B incoming tree with the same Headless Tree renderer. */
export function buildIncomingTreeModel(incoming: readonly IncomingReviewItem[]): DotdenTreeModel {
  const model: MutableTreeModel = {
    nodes: new Map([[ROOT_ID, { id: ROOT_ID, kind: 'root', name: 'root' }]]),
    childrenById: new Map([[ROOT_ID, []]]),
    expandedIds: new Set([ROOT_ID]),
  }

  const incomingRootId = nodeId('workspace', 'incoming')
  addNode(model, ROOT_ID, {
    id: incomingRootId,
    kind: 'workspace',
    name: 'Incoming Files',
    workspaceId: 'incoming',
  })
  model.expandedIds.add(incomingRootId)

  appendIncomingByRealPath(model, incomingRootId, incoming)
  return freezeModel(model)
}

function appendGroupChildren(
  model: MutableTreeModel,
  workspace: Workspace,
  parentNodeId: string,
  parentGroupId: string | null,
  groupsByParent: ReadonlyMap<string, readonly Group[]>,
  filesByBucket: ReadonlyMap<string, readonly FileTreeEntry[]>,
  remoteAxis: ReadonlyMap<string, RemoteAxisMarker>,
) {
  for (const group of groupsByParent.get(parentGroupId ?? '') ?? []) {
    const groupNodeId = nodeId('group', workspace.id, group.id)
    addNode(model, parentNodeId, {
      id: groupNodeId,
      kind: 'group',
      name: group.label,
      workspaceId: workspace.id,
      groupId: group.id,
    })
    model.expandedIds.add(groupNodeId)

    appendGroupChildren(
      model,
      workspace,
      groupNodeId,
      group.id,
      groupsByParent,
      filesByBucket,
      remoteAxis,
    )
    appendFilesByRealPath(
      model,
      groupNodeId,
      filesByBucket.get(bucketKey(workspace.id, group.id)) ?? [],
      remoteAxis,
    )
  }
}

function appendFilesByRealPath(
  model: MutableTreeModel,
  bucketNodeId: string,
  files: readonly FileTreeEntry[],
  remoteAxis: ReadonlyMap<string, RemoteAxisMarker>,
) {
  for (const file of sortByTargetPath(files)) {
    const parentId = ensureFolderPath(model, bucketNodeId, file.targetPath)
    addNode(model, parentId, {
      id: nodeId('file', bucketNodeId, file.targetPath),
      kind: 'file',
      name: leafName(file.targetPath),
      targetPath: file.targetPath,
      workspaceId: file.workspaceId,
      groupId: file.groupId,
      file,
      remoteMarker: remoteAxis.get(file.targetPath),
    })
  }
}

function appendIncomingByRealPath(
  model: MutableTreeModel,
  bucketNodeId: string,
  incoming: readonly IncomingReviewItem[],
) {
  for (const item of [...incoming].sort((a, b) => a.targetPath.localeCompare(b.targetPath))) {
    const parentId = ensureFolderPath(model, bucketNodeId, item.targetPath)
    addNode(model, parentId, {
      id: nodeId('incoming-file', bucketNodeId, item.targetPath),
      kind: 'file',
      name: leafName(item.targetPath),
      targetPath: item.targetPath,
      workspaceId: item.workspaceId,
      groupId: null,
      incoming: item,
      remoteMarker: item.marker,
    })
  }
}

function ensureFolderPath(
  model: MutableTreeModel,
  bucketNodeId: string,
  targetPath: string,
): string {
  const segments = targetPath.split('/').filter(Boolean).slice(0, -1)
  let parentId = bucketNodeId
  let folderPath = ''

  for (const segment of segments) {
    folderPath = folderPath ? `${folderPath}/${segment}` : segment
    const folderId = nodeId('folder', bucketNodeId, folderPath)
    if (!model.nodes.has(folderId)) {
      addNode(model, parentId, {
        id: folderId,
        kind: 'folder',
        name: segment,
        targetPath: folderPath,
      })
      model.expandedIds.add(folderId)
    }
    parentId = folderId
  }

  return parentId
}

function addNode(model: MutableTreeModel, parentId: string, node: DotdenTreeNode) {
  model.nodes.set(node.id, node)
  model.childrenById.set(node.id, [])
  const siblings = model.childrenById.get(parentId)
  if (!siblings) {
    throw new Error(`Cannot add ${node.id}: parent ${parentId} does not exist`)
  }
  siblings.push(node.id)
}

function bucketFilesByWorkspaceAndGroup(files: readonly FileTreeEntry[]) {
  const buckets = new Map<string, FileTreeEntry[]>()
  for (const file of files) {
    const key = bucketKey(file.workspaceId, file.groupId)
    const bucket = buckets.get(key) ?? []
    bucket.push(file)
    buckets.set(key, bucket)
  }
  return buckets
}

function bucketGroupsByParent(groups: readonly Group[]) {
  const buckets = new Map<string, Group[]>()
  for (const group of groups) {
    const key = group.parentId ?? ''
    const bucket = buckets.get(key) ?? []
    bucket.push(group)
    buckets.set(key, bucket)
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.label.localeCompare(b.label))
  }
  return buckets
}

function bucketKey(workspaceId: string, groupId: string | null) {
  return `${workspaceId}\u0000${groupId ?? ''}`
}

function nodeId(...parts: readonly string[]) {
  return parts.map(encodeURIComponent).join(':')
}

function leafName(targetPath: string) {
  return targetPath.split('/').filter(Boolean).at(-1) ?? targetPath
}

function sortByTargetPath(files: readonly FileTreeEntry[]) {
  return [...files].sort((a, b) => a.targetPath.localeCompare(b.targetPath))
}

function freezeModel(model: MutableTreeModel): DotdenTreeModel {
  return {
    rootId: ROOT_ID,
    nodes: model.nodes,
    childrenById: new Map([...model.childrenById].map(([key, value]) => [key, [...value]])),
    expandedIds: [...model.expandedIds],
  }
}
