<script lang="ts">
  import type { DirEntry } from '@shared/types'
  import { onMount, tick, untrack } from 'svelte'

  let {
    hostLabel,
    path,
    entries,
    busy,
    error,
    onNavigate,
    onOpen,
    onClose
  }: {
    hostLabel: string
    path: string
    entries: DirEntry[]
    busy: boolean
    error: string
    onNavigate: (path: string) => void
    onOpen: (path: string) => void
    onClose: () => void
  } = $props()

  let draft = $state(untrack(() => path))
  let selected = $state<DirEntry | null>(null)
  let listEl = $state<HTMLDivElement | null>(null)
  let pathInput = $state<HTMLInputElement | null>(null)
  let owned = false
  let pendingDir: string | null = null
  let lastListed = ''
  /** Name prefix from typing. Arrow keys keep this while the field shows the focused path. */
  let filter = ''

  function normalize(value: string): string {
    if (value === '' || value === '/') return '/'
    return value.replace(/\/+$/, '')
  }

  function splitAbsolute(text: string): { dir: string; segment: string } {
    if (text === '/' || text === '') return { dir: '/', segment: '' }
    if (text.endsWith('/')) return { dir: normalize(text), segment: '' }
    const slash = text.lastIndexOf('/')
    return { dir: text.slice(0, slash) || '/', segment: text.slice(slash + 1) }
  }

  function splitDraft(typed: string, current: string): { dir: string; segment: string } {
    const text = typed.trim()
    if (text === '') return { dir: current, segment: '' }
    if (!text.startsWith('/')) {
      const slash = text.indexOf('/')
      if (slash === -1) return { dir: current, segment: text }
      const base = normalize(current)
      const combined = `${base === '/' ? '' : base}/${text}`
      return splitAbsolute(combined)
    }
    return splitAbsolute(text)
  }

  function parentOf(directory: string): string | null {
    const current = normalize(directory)
    if (current === '/') return null
    return current.replace(/\/[^/]+$/, '') || '/'
  }

  function pick(rows: DirEntry[], segment: string): DirEntry | null {
    if (!segment) return null
    return rows.find((entry) => entry.name === segment) ?? rows.find((entry) => entry.name.startsWith(segment)) ?? null
  }

  function visibleEntries(): DirEntry[] {
    const parent = parentOf(path)
    const dotdot: DirEntry | null = parent === null ? null : { name: '..', path: parent, kind: 'dir' }
    let body = entries
    if (filter) {
      const matched = entries.filter((entry) => entry.name.startsWith(filter))
      if (matched.length > 0) body = matched
    }
    if (!dotdot || (filter !== '' && !'..'.startsWith(filter))) return body
    return [dotdot, ...body]
  }

  const rows = $derived(visibleEntries())

  function followTyped(): void {
    const { dir, segment } = splitDraft(draft, path)
    const wanted = normalize(dir)
    if (wanted !== normalize(path)) {
      selected = null
      if (wanted !== pendingDir) {
        pendingDir = wanted
        onNavigate(dir)
      }
      return
    }
    pendingDir = null
    selected = pick(visibleEntries(), segment)
  }

  function syncFilter(): void {
    const { dir, segment } = splitDraft(draft, path)
    filter = normalize(dir) === normalize(path) ? segment : ''
  }

  function onType(): void {
    owned = true
    followTyped()
    syncFilter()
  }

  function release(): void {
    owned = false
    pendingDir = null
    filter = ''
  }

  $effect(() => {
    const listed = path
    if (listed === lastListed) return
    lastListed = listed
    if (!owned) {
      draft = listed
      selected = null
      pendingDir = null
      filter = ''
    } else {
      const { dir, segment } = splitDraft(draft, listed)
      if (normalize(dir) === normalize(listed)) {
        pendingDir = null
        filter = segment
      }
      selected = pick(visibleEntries(), segment)
    }
    if (!selected) {
      void tick().then(() => {
        if (listEl) listEl.scrollTop = 0
      })
    }
  })

  $effect(() => {
    const current = selected?.path
    if (!current) return
    void tick().then(() => {
      const node = listEl?.querySelector(`[data-path="${CSS.escape(current)}"]`)
      if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' })
    })
  })

  function matches(): DirEntry[] {
    return rows
  }

  function pageRows(): number {
    const list = listEl
    const row = list?.querySelector('[data-path]')
    if (!list || !(row instanceof HTMLElement) || row.offsetHeight === 0) return 8
    return Math.max(1, Math.floor(list.clientHeight / row.offsetHeight))
  }

  function focusField(): void {
    const input = pathInput
    if (!input) return
    input.focus()
    const end = input.value.length
    input.setSelectionRange(end, end)
  }

  function showEntry(entry: DirEntry): void {
    selected = entry
    draft = entry.path
    void tick().then(focusField)
  }

  function enterDir(directory: string): void {
    draft = directory === '/' ? '/' : `${normalize(directory)}/`
    owned = true
    followTyped()
    syncFilter()
    void tick().then(focusField)
  }

  function move(delta: number): void {
    const rows = matches()
    if (rows.length === 0) return
    const current = selected
    const index = current ? rows.findIndex((entry) => entry.path === current.path) : -1
    const start = index === -1 ? (delta > 0 ? -1 : rows.length) : index
    const next = Math.min(rows.length - 1, Math.max(0, start + delta))
    const entry = rows[next]
    if (entry) showEntry(entry)
  }

  function accept(entry: DirEntry): void {
    if (entry.kind === 'file') {
      onOpen(entry.path)
      return
    }
    enterDir(entry.path)
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    const inField = event.target instanceof HTMLInputElement
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'PageDown' || event.key === 'PageUp') {
      if (!inField) return
      event.preventDefault()
      const page = event.key === 'PageDown' || event.key === 'PageUp'
      const down = event.key === 'ArrowDown' || event.key === 'PageDown'
      move(down ? (page ? pageRows() : 1) : page ? -pageRows() : -1)
      return
    }
    if (event.key !== 'Enter' || !inField || !selected) return
    if (selected.kind === 'dir') {
      event.preventDefault()
      enterDir(selected.path)
      return
    }
    if (normalize(draft.trim()) === normalize(selected.path)) return
    event.preventDefault()
    accept(selected)
  }

  onMount(() => {
    requestAnimationFrame(() => pathInput?.focus())
  })

  function up(): void {
    const parent = parentOf(path)
    if (!parent) return
    release()
    onNavigate(parent)
  }
</script>

<div class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6">
  <div
    class="flex h-[32rem] w-full max-w-xl flex-col rounded-lg border border-line bg-panel p-4 shadow-xl"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="browse-title"
    onkeydown={onKey}
    onmousedown={(event) => {
      const target = event.target
      if (target instanceof Element && target.closest('button')) event.preventDefault()
    }}
    onfocusout={(event) => {
      const next = event.relatedTarget
      if (!(next instanceof Node) || !event.currentTarget.contains(next)) return
      if (next instanceof HTMLInputElement) return
      focusField()
    }}
  >
    <div class="mb-2 flex items-center justify-between gap-3">
      <h2 id="browse-title" class="truncate text-sm font-normal">Open on {hostLabel}</h2>
      <button class="btn" type="button" onclick={onClose}>Close</button>
    </div>
    <form
      class="mb-3 flex gap-2"
      onsubmit={(event) => {
        event.preventDefault()
        release()
        onNavigate(draft)
      }}
    >
      <button class="btn" type="button" onclick={up} disabled={busy || path === '/'}>Up</button>
      <input
        class="field font-mono text-sm font-normal"
        autocomplete="off"
        spellcheck="false"
        bind:this={pathInput}
        bind:value={draft}
        oninput={onType}
      />
      <button class="btn" type="submit" disabled={busy}>Go</button>
    </form>
    <div class="min-h-0 flex-1 overflow-auto rounded border border-line" bind:this={listEl}>
      {#if rows.length === 0 && busy}
        <p class="p-3 text-sm text-slate-400">Listing…</p>
      {:else if rows.length === 0}
        <p class="p-3 text-sm text-slate-400">This directory is empty.</p>
      {:else}
        <ul>
          {#each rows as entry (entry.path)}
            <li>
              <button
                class="flex w-full min-w-0 items-center gap-2 px-2 text-left leading-5 hover:bg-hover {selected?.path === entry.path
                  ? 'bg-tab-active'
                  : ''}"
                type="button"
                data-path={entry.path}
                ondblclick={() => (entry.kind === 'dir' ? enterDir(entry.path) : onOpen(entry.path))}
                onclick={() => (entry.kind === 'dir' ? enterDir(entry.path) : showEntry(entry))}
              >
                <span class="w-6 shrink-0 text-xs font-normal leading-5 text-slate-500">{entry.kind === 'dir' ? 'dir' : ''}</span>
                <span class="min-w-0 truncate text-sm font-normal leading-5">{entry.name}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    {#if error}
      <p class="mt-2 text-sm text-bad">{error}</p>
    {/if}
    <div class="mt-3 flex justify-end">
      <button
        class="btn btn-accent"
        type="button"
        disabled={!selected || selected.kind !== 'file' || busy}
        onclick={() => selected && onOpen(selected.path)}
      >
        Open
      </button>
    </div>
  </div>
</div>
