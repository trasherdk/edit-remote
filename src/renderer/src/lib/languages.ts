import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { apacheLanguage } from './apache'
import { assignLanguage } from './assign'

const shellLanguage = LanguageDescription.of({
  name: 'Shell',
  alias: ['bash', 'sh', 'zsh', 'ksh'],
  extensions: ['sh', 'bash', 'zsh', 'ksh'],
  filename: /^\.(?:bashrc|bash_profile|bash_login|bash_logout|bash_aliases|zshrc|zshenv|zprofile|zlogin|zlogout|profile|kshrc)$/,
  support: new LanguageSupport(StreamLanguage.define(shell))
})

const apacheConfig = LanguageDescription.of({
  name: 'Apache',
  alias: ['httpd', 'apache'],
  filename: /^(?:httpd(?:-.+)?|apache2?)\.conf$|^\.htaccess$/i,
  support: new LanguageSupport(apacheLanguage)
})

const assignConfig = LanguageDescription.of({
  name: 'Configuration',
  alias: ['conf'],
  support: new LanguageSupport(assignLanguage)
})

const catalog = [apacheConfig, shellLanguage, ...languages]

export function languageFor(name: string, text: string): LanguageDescription | null {
  const named = LanguageDescription.matchFilename(catalog, name)
  if (named) return named
  if (shellShebang(text)) return shellLanguage
  if (/\.conf$/i.test(name)) return apacheSections(text) ? apacheConfig : assignConfig
  return null
}

function apacheSections(text: string): boolean {
  return /^\s*<\/?[A-Za-z]/m.test(text)
}

function shellShebang(text: string): boolean {
  const end = text.indexOf('\n')
  const line = end === -1 ? text : text.slice(0, end)
  return /^#!/.test(line) && /\b(?:bash|sh|zsh|ksh|dash)\b/.test(line)
}
