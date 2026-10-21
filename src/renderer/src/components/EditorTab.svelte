<script lang="ts">
  import { EditorView } from '@codemirror/view'
  import { EditorState } from '@codemirror/state'
  import { onMount } from 'svelte'
  import { applyExternalDoc, attachLanguage, editorExtensions, type EditorHooks } from '../lib/editor'

  let {
    path,
    text,
    active,
    readOnly = false,
    onChange,
    onSave,
    onCursor
  }: {
    path: string
    text: string
    active: boolean
    readOnly?: boolean
    onChange: (text: string) => void
    onSave: () => void
    onCursor: (line: number, column: number) => void
  } = $props()

  let hostEl: HTMLDivElement | undefined = $state()
  let shown = $state(0)
  let view: EditorView | undefined
  const hooks: EditorHooks = {
    onChange: () => {},
    onSave: () => {},
    onCursor: () => {}
  }

  $effect(() => {
    hooks.onChange = onChange
    hooks.onSave = onSave
    hooks.onCursor = onCursor
  })

  $effect(() => {
    const next = text
    if (shown === 0) return
    const current = view
    if (!current) return
    applyExternalDoc(current, next)
  })

  function reportCursor(current: EditorView): void {
    const pos = current.state.selection.main.head
    const line = current.state.doc.lineAt(pos)
    hooks.onCursor(line.number, pos - line.from + 1)
  }

  $effect(() => {
    if (!active || shown === 0) return
    const current = view
    if (!current) return
    current.focus()
    reportCursor(current)
  })

  onMount(() => {
    const parent = hostEl
    if (!parent) return
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        extensions: editorExtensions(hooks, readOnly)
      })
    })
    reportCursor(view)
    shown += 1
    const detach = attachLanguage(view, path, text)
    return () => {
      detach()
      view?.destroy()
      view = undefined
    }
  })
</script>

<div class="h-full min-h-0" bind:this={hostEl}></div>
