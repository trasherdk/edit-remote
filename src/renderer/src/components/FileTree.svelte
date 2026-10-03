<script lang="ts">
  import { flattenFileTree, type TreeNode } from '../lib/tree'

  let {
    nodes,
    collapsed,
    selectedPath,
    dirty,
    titleFor,
    onOpen,
    onOpenDir,
    onCollapsed
  }: {
    nodes: TreeNode[]
    collapsed: string[]
    selectedPath: string | null
    dirty: (path: string) => boolean
    titleFor: (path: string) => string
    onOpen: (path: string) => void
    onOpenDir: (path: string) => void
    onCollapsed: (paths: string[]) => void
  } = $props()

  const rows = $derived(flattenFileTree(nodes, new Set(collapsed)))

  function toggle(path: string): void {
    onCollapsed(collapsed.includes(path) ? collapsed.filter((item) => item !== path) : [...collapsed, path])
  }

</script>

{#each rows as row (row.id)}
  {#if row.kind === 'dir'}
    <div class="flex w-full min-w-0 items-center px-2 text-sm leading-5 text-slate-200 select-none hover:bg-ink">
      <span class="shrink-0 font-mono text-sm leading-5 whitespace-pre text-slate-500">{row.gutter}</span>
      <button
        class="shrink-0 cursor-default px-0 leading-5"
        type="button"
        aria-label={row.collapsed ? 'Expand' : 'Collapse'}
        onclick={() => toggle(row.path)}
      >
        <span class="font-mono text-[17px] leading-none text-slate-500">{row.collapsed ? '▸' : '▾'}</span>
      </button>
      <button
        class="min-w-0 flex-1 cursor-default truncate px-0 text-left"
        type="button"
        title={titleFor(row.path)}
        ondblclick={() => onOpenDir(row.path)}
      >
        {row.name}
      </button>
    </div>
  {:else}
    <button
      class="flex w-full min-w-0 items-center px-2 text-left text-sm leading-5 {selectedPath === row.path
        ? 'bg-ink text-accent'
        : 'hover:bg-ink'}"
      title={titleFor(row.path)}
      onclick={() => onOpen(row.path)}
    >
      <span class="shrink-0 font-mono text-sm leading-5 whitespace-pre text-slate-500">{row.gutter}</span>
      <span class="min-w-0 overflow-x-hidden text-ellipsis whitespace-nowrap">{row.name}</span>
      {#if dirty(row.path)}
        <span class="shrink-0 text-xs text-warn">unsaved</span>
      {/if}
    </button>
  {/if}
{/each}
