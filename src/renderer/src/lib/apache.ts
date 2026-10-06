import { StreamLanguage, type StreamParser } from '@codemirror/language'

type ApacheState = {
  directive: boolean
  cont: boolean
}

const parser: StreamParser<ApacheState> = {
  name: 'apache',
  startState: () => ({ directive: true, cont: false }),
  blankLine(state) {
    state.directive = true
    state.cont = false
  },
  languageData: {
    commentTokens: { line: '#' }
  },
  token(stream, state) {
    if (stream.sol()) {
      state.directive = !state.cont
      state.cont = false
    }
    if (stream.eatSpace()) return null

    const ch = stream.peek()
    if (ch === '#') {
      stream.skipToEnd()
      state.directive = false
      return 'comment'
    }
    if (ch === '"' || ch === "'") {
      stream.next()
      while (!stream.eol()) {
        const next = stream.next()
        if (next === '\\') {
          stream.next()
          continue
        }
        if (next === ch) break
      }
      state.directive = false
      return 'string'
    }
    if (ch === '<') {
      stream.next()
      stream.eat('/')
      stream.eatWhile(/[\w.-]/)
      if (!stream.skipTo('>')) stream.skipToEnd()
      else stream.next()
      state.directive = false
      return 'tagName'
    }
    if (ch === '\\') {
      stream.next()
      if (stream.eol()) {
        state.cont = true
        return null
      }
    }
    if (state.directive && /[\w-]/.test(ch ?? '')) {
      stream.eatWhile(/[\w-]/)
      state.directive = false
      return 'keyword'
    }
    if (ch && /\d/.test(ch)) {
      stream.eatWhile(/[\w.]/)
      state.directive = false
      return 'number'
    }
    stream.eatWhile(/[^\s#]/)
    state.directive = false
    return null
  }
}

export const apacheLanguage = StreamLanguage.define(parser)
