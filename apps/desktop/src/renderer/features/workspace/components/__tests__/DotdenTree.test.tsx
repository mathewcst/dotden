// @vitest-environment happy-dom

import { StrictMode, useCallback, useMemo, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  hotkeysCoreFeature,
  searchFeature,
  selectionFeature,
  syncDataLoaderFeature,
} from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { DotdenTree } from '../DotdenTree'
import {
  buildIncomingTreeModel,
  buildWorkspaceTreeModel,
  type DotdenTreeModel,
  type DotdenTreeNode,
} from '../../lib/tree-node-model'

afterEach(cleanup)

const noop = () => {}

/**
 * Mount {@link DotdenTree} over a real Headless Tree instance built from a fixed model, so the test
 * exercises the actual row composition (the only place the env-B read-only gate lives — it is not
 * reachable from the store/node-model seams).
 */
function Harness({ model, readOnly }: { model: DotdenTreeModel; readOnly: boolean }) {
  // Stable ref like DenWindow's memoized `expandedItems`; an inline array would loop the controlled
  // state (new ref every render → rebuild → setState → render).
  const expandedItems = useMemo(() => [...model.expandedIds], [model])
  const tree = useTree<DotdenTreeNode>({
    rootItemId: model.rootId,
    state: { expandedItems },
    setExpandedItems: noop,
    dataLoader: {
      getItem: (id) => model.nodes.get(id)!,
      getChildren: (id) => [...(model.childrenById.get(id) ?? [])],
    },
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().kind !== 'file',
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature, searchFeature],
  })
  return (
    <DotdenTree
      tree={tree}
      selectedPath={null}
      onSelectFile={noop}
      onRowVerb={noop}
      label="test"
      organizing={false}
      readOnly={readOnly}
      onCreateGroup={noop}
      onRenameWorkspace={noop}
      onRenameGroup={noop}
      onDeleteWorkspace={noop}
      onDeleteGroup={noop}
      onDropNode={noop}
    />
  )
}

/**
 * Mount {@link DotdenTree} with the SAME controlled-expansion wiring DenWindow uses (track collapses
 * only; containers open by default). This is the only seam that reproduces the "click a folder,
 * nothing collapses until an unrelated re-render" bug — it lives in the interaction between Headless
 * Tree's synchronous toggle and our controlled `expandedItems`.
 */
function ControlledHarness({ model }: { model: DotdenTreeModel }) {
  const [collapsedItems, setCollapsedItems] = useState<ReadonlySet<string>>(() => new Set())
  const expandedItems = useMemo(
    () => model.expandedIds.filter((id) => !collapsedItems.has(id)),
    [model, collapsedItems],
  )
  const handleSetExpanded = useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      const nextList = typeof next === 'function' ? next(expandedItems) : next
      const nextExpanded = new Set(nextList)
      const collapsed = new Set<string>()
      for (const id of model.expandedIds) if (!nextExpanded.has(id)) collapsed.add(id)
      setCollapsedItems(collapsed)
    },
    [expandedItems, model],
  )
  const tree = useTree<DotdenTreeNode>({
    rootItemId: model.rootId,
    state: { expandedItems },
    setExpandedItems: handleSetExpanded,
    dataLoader: {
      getItem: (id) => model.nodes.get(id)!,
      getChildren: (id) => [...(model.childrenById.get(id) ?? [])],
    },
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().kind !== 'file',
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature, searchFeature],
  })
  return (
    <DotdenTree
      tree={tree}
      selectedPath={null}
      onSelectFile={noop}
      onRowVerb={noop}
      label="test"
      organizing={false}
      readOnly={false}
      onCreateGroup={noop}
      onRenameWorkspace={noop}
      onRenameGroup={noop}
      onDeleteWorkspace={noop}
      onDeleteGroup={noop}
      onDropNode={noop}
    />
  )
}

describe('DotdenTree collapse (controlled expansion, like DenWindow)', () => {
  it('collapses a folder on a single click', () => {
    const model = buildWorkspaceTreeModel({
      workspaces: [{ id: 'personal', label: 'Personal', groups: [], scope: null }],
      files: [
        {
          targetPath: '.config/nvim/init.lua',
          workspaceId: 'personal',
          groupId: null,
          status: null,
          muted: false,
          scope: null,
        },
      ],
    })
    render(
      <StrictMode>
        <ControlledHarness model={model} />
      </StrictMode>,
    )

    // Open by default: the nested folder + file are visible.
    expect(screen.getByText('nvim')).toBeTruthy()
    expect(screen.getByText('init.lua')).toBeTruthy()

    // One click on `.config` must hide its descendants — no second interaction needed.
    fireEvent.click(screen.getByText('.config'))

    expect(screen.queryByText('nvim')).toBeNull()
    expect(screen.queryByText('init.lua')).toBeNull()
  })
})

describe('DotdenTree read-only gate (env B)', () => {
  it('never exposes organize verbs on the synthetic incoming Workspace', () => {
    const model = buildIncomingTreeModel([
      { targetPath: '.zshrc', workspaceId: 'incoming', marker: null } as never,
    ])
    render(<Harness model={model} readOnly />)

    // The "Incoming Files" root renders as a row, but it is NOT a real Workspace: no New Group, no
    // rename, no delete — and its files must not be draggable into a (non-existent) Group.
    expect(screen.getByText('Incoming Files')).toBeTruthy()
    expect(screen.queryByTitle('New Group')).toBeNull()
    expect(screen.queryByRole('button', { name: /workspace actions/i })).toBeNull()
    expect(screen.getByText('.zshrc').closest('[draggable="true"]')).toBeNull()
  })

  it('exposes organize verbs + drag on a real Workspace (env A)', () => {
    const model = buildWorkspaceTreeModel({
      workspaces: [{ id: 'personal', label: 'Personal', groups: [], scope: null }],
      files: [
        {
          targetPath: '.zshrc',
          workspaceId: 'personal',
          groupId: null,
          status: null,
          muted: false,
          scope: null,
        },
      ],
    })
    render(<Harness model={model} readOnly={false} />)

    expect(screen.getByTitle('New Group')).toBeTruthy()
    expect(screen.getByText('.zshrc').closest('[draggable="true"]')).toBeTruthy()
  })
})
