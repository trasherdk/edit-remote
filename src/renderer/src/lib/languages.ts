import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { shell } from '@codemirror/legacy-modes/mode/shell'

const shellLanguage = LanguageDescription.of({
  name: 'Shell',
  alias: ['bash', 'sh', 'zsh', 'ksh'],
  extensions: ['sh', 'bash', 'zsh', 'ksh'],
  filename: /^\.(?:bashrc|bash_profile|bash_login|bash_logout|bash_aliases|zshrc|zshenv|zprofile|zlogin|zlogout|profile|kshrc)$/,
  support: new LanguageSupport(StreamLanguage.define(shell))
})

const catalog = [shellLanguage, ...languages]

export function languageFor(name: string, text: string): LanguageDescription | null {
  return LanguageDescription.matchFilename(catalog, name) ?? (shellShebang(text) ? shellLanguage : null)
}

function shellShebang(text: string): boolean {
  const end = text.indexOf('\n')
  const line = end === -1 ? text : text.slice(0, end)
  return /^#!/.test(line) && /\b(?:bash|sh|zsh|ksh|dash)\b/.test(line)
}
