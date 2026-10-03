<script lang="ts">
  import { completeAnyWord } from '@codemirror/autocomplete'
  import { indentLess, indentMore } from '@codemirror/commands'
  import { indentUnit } from '@codemirror/language'
  import { EditorState, Prec, StateEffect } from '@codemirror/state'
  import { oneDark } from '@codemirror/theme-one-dark'
  import { EditorView, keymap } from '@codemirror/view'
  import { basicSetup } from 'codemirror'
  import { onMount } from 'svelte'
  import { languageFor } from '../lib/languages'
  import { fileName } from '../lib/tree'

  let {
    path,
    text,
    onChange,
    onSave,
    onCursor
  }: {
    path: string
    text: string
    onChange: (text: string) => void
    onSave: () => void
    onCursor: (line: number, column: number) => void
  } = $props()

  let hostEl: HTMLDivElement | undefined = $state()
  const hooks: {
    onChange: (text: string) => void
    onSave: () => void
    onCursor: (line: number, column: number) => void
  } = {
    onChange: () => {},
    onSave: () => {},
    onCursor: () => {}
  }

  $effect(() => {
    hooks.onChange = onChange
    hooks.onSave = onSave
    hooks.onCursor = onCursor
  })

  onMount(() => {
    const parent = hostEl
    if (!parent) return
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        extensions: [
          basicSetup,
          EditorState.languageData.of(() => [{ autocomplete: completeAnyWord, wordChars: '/._+~:@-' }]),
          indentUnit.of('\t'),
          oneDark,
          EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
          Prec.high(
            keymap.of([
              {
                key: 'Mod-s',
                run: () => {
                  hooks.onSave()
                  return true
                }
              },
              {
                key: 'Tab',
                run: (view) => {
                  const spansLines = view.state.selection.ranges.some(
                    (range) => view.state.doc.lineAt(range.from).number !== view.state.doc.lineAt(range.to).number
                  )
                  if (spansLines) return indentMore(view)
                  view.dispatch(view.state.replaceSelection('\t'))
                  return true
                },
                shift: indentLess
              }
            ])
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) hooks.onChange(update.state.doc.toString())
            if (update.docChanged || update.selectionSet) {
              const pos = update.state.selection.main.head
              const line = update.state.doc.lineAt(pos)
              hooks.onCursor(line.number, pos - line.from + 1)
            }
          })
        ]
      })
    })
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    hooks.onCursor(line.number, view.state.selection.main.head - line.from + 1)
    let alive = true
    const match = languageFor(fileName(path), text)
    if (match) {
      void match.load().then((support) => {
        if (alive) view.dispatch({ effects: StateEffect.appendConfig.of(support) })
      })
    }
    return () => {
      alive = false
      view.destroy()
    }
  })
</script>

<div class="h-full min-h-0" bind:this={hostEl}></div>
