import { completeAnyWord } from '@codemirror/autocomplete'
import { indentLess, indentMore } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { Annotation, EditorSelection, EditorState, Prec, StateEffect, Transaction, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { languageFor } from './languages'
import { fileName } from './tree'

export type EditorHooks = {
  onChange: (text: string) => void
  onSave: () => void
  onCursor: (line: number, column: number) => void
}

const remoteEdit = Annotation.define<true>()

export function applyExternalDoc(view: EditorView, next: string): void {
  const current = view.state.doc.toString()
  if (current === next) return
  let start = 0
  const shared = Math.min(current.length, next.length)
  while (start < shared && current[start] === next[start]) start += 1
  let endCurrent = current.length
  let endNext = next.length
  while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
    endCurrent -= 1
    endNext -= 1
  }
  view.dispatch({
    changes: { from: start, to: endCurrent, insert: next.slice(start, endNext) },
    annotations: [Transaction.addToHistory.of(false), remoteEdit.of(true)],
    scrollIntoView: false
  })
}

export function attachLanguage(view: EditorView, path: string, text: string): () => void {
  let alive = true
  const match = languageFor(fileName(path), text)
  if (match) {
    void match.load().then((support) => {
      if (alive) view.dispatch({ effects: StateEffect.appendConfig.of(support) })
    })
  }
  return () => {
    alive = false
  }
}

export function editorExtensions(hooks: EditorHooks, readOnly = false): Extension[] {
  return [
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
      const remote = update.transactions.some((tr) => tr.annotation(remoteEdit))
      if (update.docChanged && !remote) hooks.onChange(update.state.doc.toString())
      if ((update.docChanged || update.selectionSet) && update.view.hasFocus) {
        const pos = update.state.selection.main.head
        const line = update.state.doc.lineAt(pos)
        hooks.onCursor(line.number, pos - line.from + 1)
      }
    })
  ]
}

function scrollByLine(current: EditorView, lines: number): boolean {
  const head = current.state.selection.main.head
  const caretX = current.coordsAtPos(head)?.left
  const scroller = current.scrollDOM
  // The other compare pane copies scrollTop from this event, after the edge pad.
  scroller.dataset.holdSync = '1'
  try {
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
  } finally {
    delete scroller.dataset.holdSync
    if (scroller.isConnected) scroller.dispatchEvent(new Event('scroll'))
  }
}

function lineInside(
  current: EditorView,
  block: { from: number; to: number; top: number; bottom: number },
  edge: 'top' | 'bottom'
): { from: number; to: number; top: number; bottom: number } {
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
