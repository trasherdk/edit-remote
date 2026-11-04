import { execFileSync } from 'node:child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReleaseNotes } from './changelog.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

function fail(message) {
  console.error(message)
  process.exit(1)
}

// This machine's SSH handshake to github.com is refused before the key is
// signed, and url.insteadOf rewrites https://github.com/ back to that SSH
// remote. Talk to GitHub over HTTPS with the gh credential the script already
// requires. An empty credential.helper drops any helper that would pop a prompt.
let githubAuthArgs
function authArgs() {
  if (githubAuthArgs) return githubAuthArgs
  let owner = 'trasherdk'
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
    const match = /^git@github\.com:([^/]+)\//.exec(url)
    if (match) owner = match[1]
  } catch {
    // origin is git@github.com:<owner>/... when the remote can be read
  }
  githubAuthArgs = [
    '-c', 'url.https://github.com/.insteadOf=https://github.com/',
    '-c', `url.https://github.com/${owner}/.insteadOf=git@github.com:${owner}/`,
    '-c', 'credential.helper=',
    '-c', 'credential.https://github.com.helper=!gh auth git-credential'
  ]
  return githubAuthArgs
}

function gitEnv(opts = {}) {
  const { env, ...rest } = opts
  return {
    ...rest,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env }
  }
}

function git(args, opts = {}) {
  return execFileSync('git', [...authArgs(), ...args], { encoding: 'utf8', ...gitEnv(opts) }).trim()
}

function gitRun(args) {
  execFileSync('git', [...authArgs(), ...args], { stdio: 'inherit', ...gitEnv() })
}

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', ...opts }).trim()
}

function isAncestor(maybeAncestor, rev) {
  try {
    git(['merge-base', '--is-ancestor', maybeAncestor, rev])
    return true
  } catch {
    return false
  }
}

function pkg() {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(beta|rc)\.(\d+))?$/.exec(version)
  if (!match) fail(`package.json version "${version}" is not X.Y.Z or X.Y.Z-beta.N / X.Y.Z-rc.N`)
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    channel: match[4] || null,
    pre: match[5] ? Number(match[5]) : 0
  }
}

function formatVersion(parts, channel, pre) {
  const core = parts.join('.')
  return channel ? `${core}-${channel}.${pre}` : core
}

export function plannedVersion(version, bumpArg, channelArg) {
  const current = parseVersion(version)
  if (bumpArg) {
    const parts = bumped(current.parts, bumpArg)
    return channelArg ? formatVersion(parts, channelArg, 1) : formatVersion(parts, null, 0)
  }
  if (channelArg) {
    const pre = current.channel === channelArg ? current.pre + 1 : 1
    return formatVersion(current.parts, channelArg, pre)
  }
  return formatVersion(current.parts, null, 0)
}

function bumped(parts, kind) {
  if (kind === 'major') return [parts[0] + 1, 0, 0]
  if (kind === 'minor') return [parts[0], parts[1] + 1, 0]
  if (kind === 'patch') return [parts[0], parts[1], parts[2] + 1]
  fail(`Unknown bump "${kind}". Use patch, minor, or major.`)
}

function readArgs() {
  let bump = null
  let channel = null
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') continue
    if (arg === '--bump') {
      bump = argv[++i]
      if (!['patch', 'minor', 'major'].includes(bump)) fail(`Unknown bump "${bump ?? ''}". Use patch, minor, or major.`)
      continue
    }
    if (arg === 'beta' || arg === 'rc' || arg === '--beta' || arg === '--rc') {
      const next = arg.replace(/^--/, '')
      if (channel && channel !== next) fail('Pass only one of beta or rc.')
      channel = next
      continue
    }
    fail(`Unknown argument "${arg}". Optional channel is beta or rc.`)
  }
  return { bump, channel }
}

function writeVersion(version) {
  const json = pkg()
  json.version = version
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(json, null, 2)}\n`)
}

function main() {
const { bump: bumpArg, channel: channelArg } = readArgs()

const branch = git(['branch', '--show-current'])
if (branch !== 'develop') fail(`Release from develop only (current branch: ${branch}).`)

const dirty = git(['status', '--porcelain'])
if (dirty) fail('Working tree is not clean. Commit or stash first.')

try {
  gh(['auth', 'status'])
} catch {
  fail('gh is not authenticated. Run: gh auth login')
}

gitRun(['fetch', 'origin', '--prune', '--tags'])

const head = git(['rev-parse', 'HEAD'])
const remoteDevelop = git(['rev-parse', 'origin/develop'])
if (head !== remoteDevelop) {
  const ahead = git(['rev-list', '--count', 'origin/develop..HEAD'])
  const behind = git(['rev-list', '--count', 'HEAD..origin/develop'])
  fail(`develop is not synced with origin/develop (ahead ${ahead}, behind ${behind}).`)
}

if (!isAncestor('origin/master', 'HEAD')) {
  console.log('Merging origin/master into develop so develop continues from master')
  gitRun(['merge', 'origin/master', '-m', 'Merge origin/master into develop'])
  gitRun(['push', 'origin', 'HEAD'])
}

const version = plannedVersion(pkg().version, bumpArg, channelArg)
if (version !== pkg().version) {
  writeVersion(version)
  git(['add', 'package.json'])
  gitRun(['commit', '-m', `chore: release v${version}`])
  gitRun(['push', 'origin', 'HEAD'])
}

const tag = `v${version}`
const existing = git(['ls-remote', '--tags', 'origin', tag])
if (existing) fail(`Tag ${tag} already exists on origin.`)

if (!isAncestor('origin/master', 'HEAD')) {
  fail('develop is still not a continuation of origin/master after merge.')
}

const changes = buildReleaseNotes(tag, 'HEAD')
const title = `Release ${tag}`
const body = [
  changes.trim(),
  '',
  '## Release mechanics',
  `- Promote \`develop\` to \`master\` for **${tag}**.`,
  '- After merge, `develop` is fast-forwarded to `master` so both point at the same commit.',
  '- GitHub Actions will attach Windows (NSIS setup + portable) and Linux (AppImage + .deb) binaries.'
].join('\n')

const masterTip = git(['rev-parse', 'origin/master'])
if (masterTip === head) {
  console.log(`develop and master are already ${head}. Skipping the pull request.`)
} else {
  let pr = ''
  try {
    pr = gh(['pr', 'list', '--base', 'master', '--head', 'develop', '--json', 'url', '--jq', '.[0].url'])
  } catch {
    pr = ''
  }

  if (!pr || pr === 'null') {
    pr = gh(['pr', 'create', '--base', 'master', '--head', 'develop', '--title', title, '--body', body])
    console.log(`Opened ${pr}`)
  } else {
    console.log(`Using existing PR ${pr}`)
  }

  const notesFile = join(tmpdir(), `edit-remote-${tag}-merge.txt`)
  writeFileSync(notesFile, `${changes.trim()}\n`)
  try {
    execFileSync(
      'gh',
      ['pr', 'merge', pr, '--merge', '--delete-branch=false', '--subject', `Release ${tag}`, '--body-file', notesFile],
      { stdio: 'inherit' }
    )
  } finally {
    try {
      unlinkSync(notesFile)
    } catch {
      // The temp file only carries the merge message.
    }
  }
}

gitRun(['fetch', 'origin', 'master', 'develop', '--tags'])

const originMaster = git(['rev-parse', 'origin/master'])
if (git(['rev-parse', 'HEAD']) !== originMaster) {
  gitRun(['merge', '--ff-only', 'origin/master'])
  gitRun(['push', 'origin', 'HEAD:develop'])
}

try {
  git(['branch', '-f', 'master', 'origin/master'])
} catch {
  // local master may not exist
}

gitRun(['fetch', 'origin', 'master', 'develop'])
const tip = git(['rev-parse', 'HEAD'])
const finalMaster = git(['rev-parse', 'origin/master'])
const finalDevelop = git(['rev-parse', 'origin/develop'])
if (tip !== finalMaster || tip !== finalDevelop) {
  fail(`develop and master are not the same after release (HEAD ${tip}, origin/master ${finalMaster}, origin/develop ${finalDevelop}).`)
}

let tagged = ''
try {
  tagged = git(['rev-parse', `${tag}^{}`])
} catch {
  tagged = ''
}
if (!tagged) {
  gitRun(['tag', '-a', tag, tip, '-m', tag])
} else if (tagged !== tip) {
  fail(`Local tag ${tag} points at ${tagged}, not ${tip}.`)
}
gitRun(['push', 'origin', tag])

console.log(`Tagged ${tag} at ${tip}`)
console.log(`origin/master and origin/develop are ${tip}`)
console.log(`Release: https://github.com/trasherdk/edit-remote/releases/tag/${tag}`)
console.log('GitHub Actions publishes the GitHub Release (notes + binaries). Do not create the release locally — a published empty release blocks binary upload.')
}

const invoked = process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/release.mjs')
if (invoked) main()
