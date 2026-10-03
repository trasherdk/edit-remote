import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SshConfigHost } from '../shared/types'

function expandHome(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

function splitLine(line: string): { keyword: string; value: string } | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const comment = trimmed.search(/\s#/)
  const body = (comment >= 0 ? trimmed.slice(0, comment) : trimmed).trim()
  const eq = body.indexOf('=')
  const space = body.search(/\s/)
  if (eq >= 0 && (space < 0 || eq < space)) {
    return { keyword: body.slice(0, eq).trim().toLowerCase(), value: unquote(body.slice(eq + 1).trim()) }
  }
  if (space < 0) return null
  return { keyword: body.slice(0, space).trim().toLowerCase(), value: unquote(body.slice(space).trim()) }
}

function concrete(alias: string): boolean {
  return alias.length > 0 && !alias.includes('*') && !alias.includes('?') && !alias.startsWith('!')
}

type Block = {
  aliases: string[]
  hostname?: string
  username?: string
  port?: number
  keyPath?: string
}

/** Concrete Host entries from the user's OpenSSH config. The first value of each keyword wins. */
export function readSshConfig(): SshConfigHost[] {
  const path = join(homedir(), '.ssh', 'config')
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const blocks: Block[] = []
  let current: Block | null = null
  for (const line of text.split(/\r?\n/)) {
    const item = splitLine(line)
    if (!item || !item.value) continue
    if (item.keyword === 'host') {
      const aliases = item.value.split(/\s+/).filter(concrete)
      current = aliases.length ? { aliases } : null
      if (current) blocks.push(current)
      continue
    }
    if (!current) continue
    if (item.keyword === 'hostname' && !current.hostname) current.hostname = item.value
    else if (item.keyword === 'user' && !current.username) current.username = item.value
    else if (item.keyword === 'port' && current.port === undefined) {
      const port = Number(item.value)
      if (Number.isInteger(port) && port >= 1 && port <= 65535) current.port = port
    } else if (item.keyword === 'identityfile' && !current.keyPath) current.keyPath = expandHome(item.value)
  }
  const hosts: SshConfigHost[] = []
  for (const block of blocks) {
    for (const alias of block.aliases) {
      if (!block.username || !block.keyPath) continue
      hosts.push({
        alias,
        hostname: block.hostname || alias,
        port: block.port ?? 22,
        username: block.username,
        keyPath: block.keyPath
      })
    }
  }
  return hosts
}
