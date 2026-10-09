<script lang="ts">
  import { completeAnyWord } from '@codemirror/autocomplete'
  import { indentLess, indentMore } from '@codemirror/commands'
  import { indentUnit } from '@codemirror/language'
  import { EditorSelection, EditorState, Prec, StateEffect } from '@codemirror/state'
  import { oneDark } from '@codemirror/theme-one-dark'
  import { EditorView, keymap } from '@codemirror/view'
  import { basicSetup } from 'codemirror'
  import { onMount } from 'svelte'
  import { languageFor } from '../lib/languages'
import { fileName } from '../lib/tree'

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

  function scrollByLine(current: EditorView, lines: number): boolean {
    const head = current.state.selection.main.head
    const caretX = current.coordsAtPos(head)?.left
    const scroller = current.scrollDOM
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const clamp = (scroll: number) => Math.min(maxScroll, Math.max(0, scroll))
    scroller.scrollTop = clamp(scroller.scrollTop + lines * current.defaultLineHeight)
    const box = scroller.getBoundingClientRect()
    const visibleTop = box.top + scroller.clientTop
    const visibleBottom = visibleTop + scroller.clientHeight
    const top = visibleTop - current.documentTop
    const bottom = visibleBottom - current.documentTop
    if (bottom <= top) return true
    const topBlock = lineInside(current, current.lineBlockAtHeight(Math.max(0, top)), 'top')
    const bottomBlock = lineInside(current, current.lineBlockAtHeight(Math.max(0, bottom - 1)), 'bottom')
    const edge = head < topBlock.from ? 'top' : head >= bottomBlock.to ? 'bottom' : null
    if (!edge) return true
    const block = edge === 'top' ? topBlock : bottomBlock
    const line = current.state.doc.lineAt(block.from)
    const column = head - current.state.doc.lineAt(head).from
    let pos = Math.min(line.from + column, line.to)
    const sample = current.coordsAtPos(line.from)
    if (sample && caretX != null) {
      const found = current.posAtCoords({ x: caretX, y: (sample.top + sample.bottom) / 2 }, false)
      if (found != null && found >= line.from && found <= line.to) pos = found
    }
    const main = current.state.selection.main
    if (pos !== main.head || !main.empty) {
      current.dispatch({
        selection: current.state.selection.replaceRange(EditorSelection.cursor(pos)),
        scrollIntoView: false
      })
    }
    const coords = current.coordsAtPos(pos)
    const pad = 4
    if (coords && edge === 'top' && coords.top < visibleTop + pad) scroller.scrollTop = clamp(scroller.scrollTop - (visibleTop + pad - coords.top))
    if (coords && edge === 'bottom' && coords.bottom > visibleBottom - pad) scroller.scrollTop = clamp(scroller.scrollTop + (coords.bottom - (visibleBottom - pad)))
    return true
  }

  function lineInside(current: EditorView, block: { from: number; to: number; top: number; bottom: number }, edge: 'top' | 'bottom'): { from: number; to: number } {
    const limit = current.scrollDOM.getBoundingClientRect()
    const visibleTop = limit.top + current.scrollDOM.clientTop
    const visibleBottom = visibleTop + current.scrollDOM.clientHeight
    const top = visibleTop - current.documentTop
    const bottom = visibleBottom - current.documentTop
    if (edge === 'top' && block.top < top - 1) {
      const line = current.state.doc.lineAt(block.from)
      if (line.to < current.state.doc.length) return current.lineBlockAt(line.to + 1)
    }
    if (edge === 'bottom' && block.bottom > bottom + 1 && block.from > 0) {
      const prev = current.lineBlockAt(block.from - 1)
      if (prev.from < block.from) return prev
    }
    return block
  }

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
        extensions: [
          basicSetup,
          ...(readOnly ? [EditorState.readOnly.of(true)] : []),
          EditorState.languageData.of(() => [{ autocomplete: completeAnyWord, wordChars: '/._+~:@-' }]),
          indentUnit.of('\t'),
          oneDark,
          EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
          Prec.high(
            keymap.of([
              {
                key: 'Ctrl-ArrowUp',
                preventDefault: true,
                run: (current) => scrollByLine(current, -1)
              },
              {
                key: 'Ctrl-ArrowDown',
                preventDefault: true,
                run: (current) => scrollByLine(current, 1)
              },
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
    reportCursor(view)
    shown += 1
    let alive = true
    const match = languageFor(fileName(path), text)
    if (match) {
      void match.load().then((support) => {
        if (alive) view?.dispatch({ effects: StateEffect.appendConfig.of(support) })
      })
    }
    return () => {
      alive = false
      view?.destroy()
      view = undefined
    }
  })
</script>

<div class="h-full min-h-0" bind:this={hostEl}></div>
