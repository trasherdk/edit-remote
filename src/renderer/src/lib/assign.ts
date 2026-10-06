import { StreamLanguage, type StreamParser } from '@codemirror/language'

type AssignState = { value: boolean }

const parser: StreamParser<AssignState> = {
  name: 'assign',
  startState: () => ({ value: false }),
  blankLine(state) {
    state.value = false
  },
  languageData: {
    commentTokens: { line: '#' }
  },
  token(stream, state) {
    if (stream.sol()) state.value = false
    if (stream.eatSpace()) return null
    if (stream.peek() === '#') {
      stream.skipToEnd()
      return 'comment'
    }
    if (!state.value && (stream.peek() === '=' || stream.peek() === ':')) {
      stream.next()
      state.value = true
      return 'operator'
    }
    if (state.value) {
      stream.eatWhile(/[^\s#]/)
      return /^\d+(?:\.\d+)*$/.test(stream.current()) ? 'number' : 'string'
    }
    if (!stream.eatWhile(/[\w.-]/)) stream.next()
    return /[\w.-]/.test(stream.current()) ? 'propertyName' : null
  }
}

export const assignLanguage = StreamLanguage.define(parser)
