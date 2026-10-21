<script lang="ts">
  import { MergeView, type Chunk } from '@codemirror/merge'
  import type { EditorView } from '@codemirror/view'
  import { onMount } from 'svelte'
  import { applyExternalDoc, attachLanguage, editorExtensions, type EditorHooks } from '../lib/editor'

  const RIGHT_CHEVRON =
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 3.5 L6.5 7 L3 10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 3.5 L10.5 7 L7 10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  const LEFT_CHEVRON =
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M11 3.5 L7.5 7 L11 10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 3.5 L3.5 7 L7 10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'

  let {
    active,
    focus,
    sourcePath,
    destPath,
    sourceText,
    destText,
    sourceReadOnly = false,
    destReadOnly = false,
    sourceAlias,
    destAlias,
    sourceIdentity,
    destIdentity,
    sourceDirty,
    destDirty,
    onChange,
    onSave,
    onCursor,
    onFocus
  }: {
    active: boolean
    focus: 'source' | 'dest'
    sourcePath: string
    destPath: string
    sourceText: string
    destText: string
    sourceReadOnly?: boolean
    destReadOnly?: boolean
    sourceAlias: string
    destAlias: string
    sourceIdentity: string
    destIdentity: string
    sourceDirty: boolean
    destDirty: boolean
    onChange: (side: 'source' | 'dest', text: string) => void
    onSave: () => void
    onCursor: (line: number, column: number) => void
    onFocus: (side: 'source' | 'dest') => void
  } = $props()

  let hostEl: HTMLDivElement | undefined = $state()
  let shown = $state(0)
  let merge: MergeView | undefined
  const sourceHooks: EditorHooks = { onChange: () => {}, onSave: () => {}, onCursor: () => {} }
  const destHooks: EditorHooks = { onChange: () => {}, onSave: () => {}, onCursor: () => {} }
  const sideHooks: { onFocus: (side: 'source' | 'dest') => void } = { onFocus: () => {} }

  $effect(() => {
    sourceHooks.onChange = (text) => onChange('source', text)
    destHooks.onChange = (text) => onChange('dest', text)
    sourceHooks.onSave = onSave
    destHooks.onSave = onSave
    sourceHooks.onCursor = onCursor
    destHooks.onCursor = onCursor
    sideHooks.onFocus = onFocus
  })

  $effect(() => {
    const nextSource = sourceText
    const nextDest = destText
    if (shown === 0) return
    const current = merge
    if (!current) return
    applyExternalDoc(current.b, nextSource)
    applyExternalDoc(current.a, nextDest)
  })

  function report(pane: EditorView): void {
    const pos = pane.state.selection.main.head
    const line = pane.state.doc.lineAt(pos)
    const hooks = pane === merge?.b ? sourceHooks : destHooks
    hooks.onCursor(line.number, pos - line.from + 1)
  }

  $effect(() => {
    if (!active || shown === 0) return
    const current = merge
    if (!current) return
    current.a.requestMeasure()
    current.b.requestMeasure()
    const pane = focus === 'source' ? current.b : current.a
    if (!pane.hasFocus) pane.focus()
    report(pane)
  })

  onMount(() => {
    const parent = hostEl
    if (!parent) return
    const ontoRightBlocked = destReadOnly
    const ontoLeftBlocked = sourceReadOnly
    merge = new MergeView({
      a: { doc: destText, extensions: editorExtensions(destHooks, destReadOnly) },
      b: { doc: sourceText, extensions: editorExtensions(sourceHooks, sourceReadOnly) },
      parent,
      orientation: 'b-a',
      revertControls: 'b-to-a',
      highlightChanges: true,
      gutter: false,
      renderRevertControl: () => {
        const row = document.createElement('div')
        row.className = 'cm-compare-actions'
        row.append(copyButton('right', ontoRightBlocked), copyButton('left', ontoLeftBlocked))
        return row
      }
    })
    const gutter = merge.dom.querySelector('.cm-merge-revert')
    const view = merge
    const place = (): void => {
      if (!(gutter instanceof HTMLElement)) return
      const gutterTop = gutter.getBoundingClientRect().top
      for (const node of gutter.children) {
        if (!(node instanceof HTMLElement)) continue
        const chunk = view.chunks[Number(node.dataset.chunk)]
        if (!chunk) continue
        const next = `${Math.round(view.a.documentTop + view.a.lineBlockAt(chunk.fromA).top - gutterTop)}px`
        if (node.style.top !== next) node.style.top = next
      }
    }
    let lock = false
    const sync = (source: HTMLElement, other: HTMLElement): void => {
      if (source.dataset.holdSync) return
      if (!lock && other.scrollTop !== source.scrollTop) {
        lock = true
        other.scrollTop = source.scrollTop
        lock = false
      }
      place()
    }
    const leftScroller = view.b.scrollDOM
    const rightScroller = view.a.scrollDOM
    const onLeft = (): void => sync(leftScroller, rightScroller)
    const onRight = (): void => sync(rightScroller, leftScroller)
    leftScroller.addEventListener('scroll', onLeft)
    rightScroller.addEventListener('scroll', onRight)
    const onPointer = (event: Event): void => {
      if (!(event.target instanceof Element) || !(gutter instanceof HTMLElement)) return
      const button = event.target.closest('button')
      if (!(button instanceof HTMLButtonElement) || !gutter.contains(button)) return
      event.preventDefault()
      event.stopPropagation()
      if (button.disabled) return
      const chunk = view.chunks[Number(button.parentElement?.dataset.chunk)]
      if (!chunk) return
      const ontoRight = button.dataset.dir === 'right'
      if (ontoRight ? ontoRightBlocked : ontoLeftBlocked) return
      copyChunk(view, chunk, ontoRight ? 'a' : 'b')
    }
    gutter?.addEventListener('mousedown', onPointer, true)
    const observer = new MutationObserver(() => place())
    if (gutter) observer.observe(gutter, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] })
    const onFocusLeft = (): void => sideHooks.onFocus('source')
    const onFocusRight = (): void => sideHooks.onFocus('dest')
    view.b.dom.addEventListener('focusin', onFocusLeft)
    view.a.dom.addEventListener('focusin', onFocusRight)
    const detachLeft = attachLanguage(view.b, sourcePath, sourceText)
    const detachRight = attachLanguage(view.a, destPath, destText)
    shown += 1
    return () => {
      detachLeft()
      detachRight()
      observer.disconnect()
      leftScroller.removeEventListener('scroll', onLeft)
      rightScroller.removeEventListener('scroll', onRight)
      gutter?.removeEventListener('mousedown', onPointer, true)
      view.b.dom.removeEventListener('focusin', onFocusLeft)
      view.a.dom.removeEventListener('focusin', onFocusRight)
      view.destroy()
      merge = undefined
    }
  })

  function copyButton(dir: 'right' | 'left', disabled: boolean): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-compare-copy'
    button.dataset.dir = dir
    button.disabled = disabled
    button.title = dir === 'right' ? 'Copy left onto right' : 'Copy right onto left'
    button.setAttribute('aria-label', button.title)
    button.innerHTML = dir === 'right' ? RIGHT_CHEVRON : LEFT_CHEVRON
    return button
  }

  function copyChunk(view: MergeView, chunk: Chunk, dest: 'a' | 'b'): void {
    const ontoRight = dest === 'a'
    const source = ontoRight ? view.b : view.a
    const target = ontoRight ? view.a : view.b
    const srcFrom = ontoRight ? chunk.fromB : chunk.fromA
    const srcTo = ontoRight ? chunk.toB : chunk.toA
    const destFrom = ontoRight ? chunk.fromA : chunk.fromB
    const destTo = ontoRight ? chunk.toA : chunk.toB
    let insert = source.state.sliceDoc(srcFrom, Math.max(srcFrom, srcTo - 1))
    if (srcFrom !== srcTo && destTo <= target.state.doc.length) insert += source.state.lineBreak
    target.dispatch({
      changes: { from: destFrom, to: Math.min(target.state.doc.length, destTo), insert },
      userEvent: 'revert',
      scrollIntoView: false
    })
  }
</script>

<div class="compare-panes flex h-full min-h-0 flex-col">
  <div class="grid shrink-0 grid-cols-[1fr_var(--compare-gutter)_1fr] border-b border-line bg-panel">
    <div class="min-w-0 px-3 py-1">
      <div class="flex min-w-0 items-center gap-2 text-xs">
        <span class="truncate text-slate-100">Source · {sourceAlias}</span>
        {#if sourceReadOnly}<span class="shrink-0 text-slate-400">read-only</span>{/if}
        {#if sourceDirty}<span class="shrink-0 text-warn">unsaved</span>{/if}
      </div>
      <div class="truncate text-xs text-slate-400" title={sourceIdentity}>{sourceIdentity}</div>
    </div>
    <div></div>
    <div class="min-w-0 px-3 py-1">
      <div class="flex min-w-0 items-center gap-2 text-xs">
        <span class="truncate text-slate-100">Destination · {destAlias}</span>
        {#if destReadOnly}<span class="shrink-0 text-slate-400">read-only</span>{/if}
        {#if destDirty}<span class="shrink-0 text-warn">unsaved</span>{/if}
      </div>
      <div class="truncate text-xs text-slate-400" title={destIdentity}>{destIdentity}</div>
    </div>
  </div>
  <div class="min-h-0 flex-1" bind:this={hostEl}></div>
</div>
