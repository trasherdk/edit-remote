<script lang="ts">
  import { COLLAPSED_HOST, type DirEntry, type HostInput, type HostProfile, type HostStatus, type LineEnding, type MenuCommand, type Project, type RememberedFile, type SshConfigHost, type UpdateChannel } from '@shared/types'
  import { onMount } from 'svelte'
  import BrowseDialog from './components/BrowseDialog.svelte'
  import EditorTab from './components/EditorTab.svelte'
  import FileTree from './components/FileTree.svelte'
  import HostDialog from './components/HostDialog.svelte'
  import SettingsDialog from './components/SettingsDialog.svelte'
  import ToolButton from './components/ToolButton.svelte'
  import { ancestorDirs, buildTree, fileName } from './lib/tree'

  type Tab = {
    hostId: string
    path: string
    text: string
    dirty: boolean
    writable: boolean
    lineEnding: LineEnding
    size: number | null
    mtime: number | null
  }

  type Selection = { kind: 'host'; hostId: string } | { kind: 'file'; hostId: string; path: string } | null

  let project = $state<Project | null>(null)
  let hosts = $state<HostProfile[]>([])
  let sshHosts = $state<SshConfigHost[]>([])
  let side = $state<'hosts' | 'files'>('hosts')
  let encryptionAvailable = $state(true)
  let banner = $state('')
  let busy = $state(false)
  let saving = false
  let tabs = $state<Tab[]>([])
  let activeKey = $state<string | null>(null)
  let recentKey = $state<string | null>(null)
  let selection = $state<Selection>(null)
  let hostStatus = $state<Record<string, { status: HostStatus; error?: string }>>({})
  let cursor = $state({ line: 1, column: 1 })

  let hostDialog = $state<null | { mode: 'add' | 'edit'; host: HostProfile | null }>(null)
  let settingsOpen = $state(false)
  let updateChannel = $state<UpdateChannel>('stable')
  let hostError = $state('')

  let browse = $state<null | { hostId: string; path: string; entries: DirEntry[]; error: string }>(null)
  let browseRequest = 0
  let collapsed = $state<RememberedFile[]>([])
  let dragKey = $state<string | null>(null)
  let fileErrors = $state<Record<string, string>>({})
  let saveNote = $state('')
  let appVersion = $state('')
  let statusEpoch = 0

  const activeTab = $derived(tabs.find((tab) => tabKey(tab.hostId, tab.path) === activeKey) ?? null)
  const selectedHostId = $derived(selection?.hostId ?? activeTab?.hostId ?? null)
  const selectedHost = $derived(hosts.find((host) => host.id === selectedHostId) ?? null)
  const listHost = $derived.by(() => {
    if (side === 'hosts') {
      if (selection?.kind !== 'host') return null
    } else if (!selection) return null
    const hostId = selection?.hostId
    if (!hostId) return null
    return hosts.find((host) => host.id === hostId) ?? null
  })
  const fileGroups = $derived.by(() => {
    if (!project) return []
    const current = project
    return hosts
      .map((host) => ({
        host,
        paths: current.files.filter((file) => file.hostId === host.id).map((file) => file.path)
      }))
      .filter((group) => group.paths.length > 0)
  })

  function tabKey(hostId: string, path: string): string {
    return `${hostId}\0${path}`
  }

  let tabStrip = $state<HTMLDivElement | undefined>(undefined)

  function scrollTabStrip(event: WheelEvent): void {
    const strip = tabStrip
    if (!strip || strip.scrollWidth <= strip.clientWidth || event.deltaY === 0) return
    const raw = event.deltaY
    const delta =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? raw * 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? raw * strip.clientWidth
          : raw
    event.preventDefault()
    strip.scrollLeft += delta
  }

  $effect(() => {
    const key = activeKey
    const strip = tabStrip
    const order = tabs.map((tab) => tabKey(tab.hostId, tab.path)).join('\n')
    if (!key || !strip || !order) return
    const tab = strip.querySelector('[data-active-tab="true"]')
    if (!(tab instanceof HTMLElement)) return
    const stripRect = strip.getBoundingClientRect()
    const tabRect = tab.getBoundingClientRect()
    if (tabRect.left < stripRect.left) strip.scrollLeft -= stripRect.left - tabRect.left
    else if (tabRect.right > stripRect.right) strip.scrollLeft += tabRect.right - stripRect.right
  })

  function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  function identity(host: HostProfile, path: string): string {
    return `${host.displayName}:${path}`
  }

  function statusOf(hostId: string): HostStatus {
    return hostStatus[hostId]?.status ?? 'disconnected'
  }

  function setFileError(hostId: string, path: string, error: string | null): void {
    const key = tabKey(hostId, path)
    if (!error) {
      if (!(key in fileErrors)) return
      const next = { ...fileErrors }
      delete next[key]
      fileErrors = next
      return
    }
    fileErrors = { ...fileErrors, [key]: error }
  }

  function isDirty(hostId: string, path: string): boolean {
    return tabs.some((tab) => tab.hostId === hostId && tab.path === path && tab.dirty)
  }

  function hasDirty(): boolean {
    return tabs.some((tab) => tab.dirty)
  }

  function setHostStatus(hostId: string, status: HostStatus, error?: string): void {
    statusEpoch += 1
    hostStatus = { ...hostStatus, [hostId]: { status, error } }
  }

  onMount(() => {
    const stop = window.api.host.onStatus((event) => {
      setHostStatus(event.hostId, event.status, event.error)
      if (event.status === 'failed' && event.error) banner = event.error
    })
    void window.api.encryptionAvailable().then((ok) => {
      encryptionAvailable = ok
    })
    void window.api.app.version().then((value) => {
      appVersion = value
    })
    void (async () => {
      await refreshStatuses()
      const picked = selection
      if (tabs.length === 0) await restoreSession()
      else if (picked?.kind === 'file' && tabs.some((tab) => tab.hostId === picked.hostId && tab.path === picked.path))
        activeKey = tabKey(picked.hostId, picked.path)
      else if (activeTab) selection = { kind: 'file', hostId: activeTab.hostId, path: activeTab.path }
      await refreshStatuses()
    })()
    const onKey = (event: KeyboardEvent) => {
      if (browse || hostDialog || settingsOpen) return
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === 'Tab') {
        event.preventDefault()
        if (!event.repeat) toggleRecentTab()
        return
      }
      const digit = /^Digit([1-9])$/.exec(event.code)
      if (digit && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault()
        if (!event.repeat) showTabAt(Number(digit[1]) - 1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    const stopMenu = window.api.onMenu((command) => runMenu(command))
    return () => {
      stopStartupRetry()
      stop()
      stopMenu()
      window.removeEventListener('keydown', onKey, true)
    }
  })

  async function refreshStatuses(): Promise<void> {
    const epoch = statusEpoch
    let events: Awaited<ReturnType<typeof window.api.host.statuses>>
    try {
      events = await window.api.host.statuses()
    } catch {
      return
    }
    if (epoch !== statusEpoch) return
    const next: typeof hostStatus = {}
    for (const event of events) next[event.hostId] = { status: event.status, error: event.error }
    hostStatus = next
  }

  function persistOpenFiles(): void {
    const files = tabs.map((tab) => ({ hostId: tab.hostId, path: tab.path }))
    const active = activeTab ? { hostId: activeTab.hostId, path: activeTab.path } : null
    void window.api.project.setOpenFiles(files, active)
  }

  function hostFolded(hostId: string): boolean {
    return collapsed.some((item) => item.hostId === hostId && item.path === COLLAPSED_HOST)
  }

  function collapsedPaths(hostId: string): string[] {
    return collapsed.filter((item) => item.hostId === hostId && item.path !== COLLAPSED_HOST).map((item) => item.path)
  }

  function persistCollapsed(): void {
    const rows = collapsed.map((item) => ({ hostId: item.hostId, path: item.path }))
    void window.api.project.setCollapsed(rows)
  }

  function setCollapsed(hostId: string, paths: string[]): void {
    const fold = collapsed.filter((item) => item.hostId === hostId && item.path === COLLAPSED_HOST)
    collapsed = [...collapsed.filter((item) => item.hostId !== hostId), ...fold, ...paths.map((path) => ({ hostId, path }))]
    persistCollapsed()
  }

  function toggleHost(hostId: string): void {
    collapsed = hostFolded(hostId)
      ? collapsed.filter((item) => item.hostId !== hostId || item.path !== COLLAPSED_HOST)
      : [...collapsed, { hostId, path: COLLAPSED_HOST }]
    persistCollapsed()
  }

  function revealFile(hostId: string, path: string): void {
    const ancestors = new Set(ancestorDirs(path))
    const next = collapsed.filter((item) => item.hostId !== hostId || (item.path !== COLLAPSED_HOST && !ancestors.has(item.path)))
    if (next.length === collapsed.length) return
    collapsed = next
    persistCollapsed()
  }

  async function restoreSession(): Promise<void> {
    try {
      const restored = await window.api.project.restore()
      if (!restored) return
      hosts = restored.hosts
      project = restored.project
      collapsed = restored.collapsed
      if (!project) return
      if (project.files.length > 0) side = 'files'
      await Promise.all(restored.openFiles.map((file) => openRemote(file.hostId, file.path, false, false)))
      orderTabs(restored.openFiles)
      const active = restored.activeFile
      if (active && tabs.some((tab) => tab.hostId === active.hostId && tab.path === active.path)) {
        focusFile(active.hostId, active.path)
      }
      queueStartupRetry(restored.openFiles, active ?? null)
    } catch (err) {
      banner = message(err)
    }
  }

  const STARTUP_RETRY_MS = 5000
  let pendingOpen: RememberedFile[] = []
  let startupOrder: RememberedFile[] = []
  let startupActive: RememberedFile | null = null
  let startupRetryTimer: ReturnType<typeof setTimeout> | null = null
  let startupRetrying = false
  const startupRetrySkip = new Set<string>()

  function stopStartupRetry(): void {
    pendingOpen = []
    startupRetrySkip.clear()
    if (startupRetryTimer !== null) {
      clearTimeout(startupRetryTimer)
      startupRetryTimer = null
    }
  }

  function dropHostRetry(hostId: string): void {
    startupRetrySkip.add(hostId)
    pendingOpen = pendingOpen.filter((file) => file.hostId !== hostId)
    if (pendingOpen.length === 0 && startupRetryTimer !== null) {
      clearTimeout(startupRetryTimer)
      startupRetryTimer = null
    }
  }

  function scheduleStartupRetry(): void {
    if (startupRetryTimer !== null || pendingOpen.length === 0) return
    startupRetryTimer = setTimeout(() => {
      startupRetryTimer = null
      void retryStartupFiles()
    }, STARTUP_RETRY_MS)
  }

  function queueStartupRetry(openFiles: RememberedFile[], active: RememberedFile | null): void {
    startupOrder = openFiles
    startupActive = active
    startupRetrySkip.clear()
    pendingOpen = openFiles.filter((file) => {
      const open = tabs.some((tab) => tab.hostId === file.hostId && tab.path === file.path)
      return !open && statusOf(file.hostId) !== 'connected'
    })
    scheduleStartupRetry()
  }

  function permanentConnectError(text: string): boolean {
    return /passphrase|host key|authentication|bad password|encrypted|parse/i.test(text)
  }

  async function loadPendingFile(hostId: string, path: string): Promise<'loaded' | 'file' | 'offline'> {
    const key = tabKey(hostId, path)
    if (tabs.some((tab) => tabKey(tab.hostId, tab.path) === key)) return 'loaded'
    const previous = fileErrors[key]
    try {
      const loaded = await window.api.file.read(hostId, path)
      setHostStatus(hostId, 'connected')
      if (!tabs.some((tab) => tabKey(tab.hostId, tab.path) === key)) {
        tabs = [
          ...tabs,
          {
            hostId,
            path,
            text: loaded.text,
            dirty: false,
            writable: loaded.writable,
            lineEnding: loaded.lineEnding,
            size: loaded.size,
            mtime: loaded.mtime
          }
        ]
        orderTabs(startupOrder)
      }
      setFileError(hostId, path, null)
      if (previous && banner === previous) banner = ''
      if (startupActive?.hostId === hostId && startupActive.path === path && activeKey === null) focusFile(hostId, path)
      return 'loaded'
    } catch (err) {
      setFileError(hostId, path, message(err))
      return statusOf(hostId) === 'connected' ? 'file' : 'offline'
    }
  }

  async function retryHost(hostId: string): Promise<void> {
    if (startupRetrySkip.has(hostId) || !pendingOpen.some((file) => file.hostId === hostId)) return
    if (!hosts.some((host) => host.id === hostId)) {
      dropHostRetry(hostId)
      return
    }
    if (statusOf(hostId) === 'connecting') return
    try {
      if (statusOf(hostId) !== 'connected') {
        await window.api.host.connect(hostId)
        if (startupRetrySkip.has(hostId)) {
          await window.api.host.disconnect(hostId)
          return
        }
        setHostStatus(hostId, 'connected')
      }
    } catch (err) {
      const text = message(err)
      setHostStatus(hostId, 'failed', text)
      for (const file of pendingOpen.filter((item) => item.hostId === hostId)) setFileError(file.hostId, file.path, text)
      if (permanentConnectError(text)) dropHostRetry(hostId)
      return
    }
    if (startupRetrySkip.has(hostId)) return
    for (const file of pendingOpen.filter((item) => item.hostId === hostId)) {
      if (startupRetrySkip.has(hostId)) return
      if (!pendingOpen.some((item) => item.hostId === file.hostId && item.path === file.path)) continue
      const result = await loadPendingFile(file.hostId, file.path)
      if (result === 'file') pendingOpen = pendingOpen.filter((item) => item.hostId !== file.hostId || item.path !== file.path)
    }
  }

  async function retryStartupFiles(): Promise<void> {
    if (startupRetrying || pendingOpen.length === 0) return
    startupRetrying = true
    try {
      const hostIds = [...new Set(pendingOpen.map((file) => file.hostId))]
      await Promise.all(hostIds.map((hostId) => retryHost(hostId)))
    } finally {
      startupRetrying = false
      pendingOpen = pendingOpen.filter((file) => !tabs.some((tab) => tab.hostId === file.hostId && tab.path === file.path))
      if (pendingOpen.length > 0) scheduleStartupRetry()
    }
  }

  async function newProject(): Promise<void> {
    if (hasDirty() && !confirm('Discard unsaved edits and create a new project?')) return
    busy = true
    banner = ''
    try {
      const created = await window.api.project.create()
      if (!created) return
      project = created
      collapsed = []
      side = 'hosts'
      stopStartupRetry()
      tabs = []
      activeKey = null
      selection = null
      await refreshStatuses()
      persistOpenFiles()
    } catch (err) {
      banner = message(err)
    } finally {
      busy = false
    }
  }

  async function openProject(): Promise<void> {
    if (hasDirty() && !confirm('Discard unsaved edits and open another project?')) return
    busy = true
    banner = ''
    try {
      const opened = await window.api.project.open()
      if (!opened) return
      project = opened.project
      hosts = opened.hosts
      collapsed = opened.collapsed
      side = opened.project.files.length > 0 ? 'files' : 'hosts'
      stopStartupRetry()
      tabs = []
      activeKey = null
      selection = null
      await refreshStatuses()
      persistOpenFiles()
    } catch (err) {
      banner = message(err)
    } finally {
      busy = false
    }
  }

  async function saveHost(input: HostInput): Promise<void> {
    busy = true
    hostError = ''
    try {
      hosts = await window.api.host.save(input)
      hostDialog = null
    } catch (err) {
      hostError = message(err)
    } finally {
      busy = false
    }
  }

  async function beginAddHost(): Promise<void> {
    try {
      sshHosts = await window.api.sshHosts()
    } catch (err) {
      sshHosts = []
      banner = message(err)
    }
    hostDialog = { mode: 'add', host: null }
  }

  async function removeSelectedHost(): Promise<void> {
    if (!listHost) return
    const hostId = listHost.id
    const label = listHost.displayName
    const count = project?.files.filter((file) => file.hostId === hostId).length ?? 0
    const note = count ? ` This removes ${count} remembered file${count === 1 ? '' : 's'} from the open project.` : ''
    if (!confirm(`Remove ${label} from settings?${note}`)) return
    busy = true
    banner = ''
    try {
      const removed = await window.api.host.remove(hostId)
      hosts = removed.hosts
      if (removed.project) project = removed.project
      dropHostRetry(hostId)
      tabs = tabs.filter((tab) => tab.hostId !== hostId)
      fileErrors = Object.fromEntries(Object.entries(fileErrors).filter(([key]) => !key.startsWith(`${hostId}\0`)))
      if (activeKey?.startsWith(`${hostId}\0`)) activeKey = tabs[0] ? tabKey(tabs[0].hostId, tabs[0].path) : null
      selection = null
      collapsed = collapsed.filter((item) => item.hostId !== hostId)
      persistCollapsed()
      persistOpenFiles()
    } catch (err) {
      banner = message(err)
    } finally {
      busy = false
    }
  }

  async function connectSelected(): Promise<void> {
    if (!listHost) return
    banner = ''
    const hostId = listHost.id
    setHostStatus(hostId, 'connecting')
    try {
      await window.api.host.connect(hostId)
      setHostStatus(hostId, 'connected')
    } catch (err) {
      setHostStatus(hostId, 'failed', message(err))
      banner = message(err)
    }
  }

  async function disconnectSelected(): Promise<void> {
    if (!listHost) return
    dropHostRetry(listHost.id)
    await window.api.host.disconnect(listHost.id)
  }

  async function openBrowseAt(hostId: string, directory: string): Promise<void> {
    selection = { kind: 'host', hostId }
    browse = { hostId, path: directory, entries: [], error: '' }
    await navigate(directory)
  }

  async function openBrowseFor(host: HostProfile): Promise<void> {
    if (!project) {
      banner = 'Open a project before opening files.'
      return
    }
    const start = host.lastDirectory || host.defaultDirectory || '.'
    await openBrowseAt(host.id, start)
  }

  async function openBrowse(): Promise<void> {
    if (!listHost) return
    await openBrowseFor(listHost)
  }

  async function navigate(directory: string): Promise<void> {
    if (!browse) return
    const hostId = browse.hostId
    const request = ++browseRequest
    busy = true
    browse = { ...browse, error: '' }
    try {
      const result = await window.api.host.list(hostId, directory)
      if (request !== browseRequest || !browse || browse.hostId !== hostId) return
      project = result.project
      hosts = result.hosts
      browse = { hostId, path: result.path, entries: result.entries, error: '' }
      setHostStatus(hostId, 'connected')
      if (result.file) await openRemote(hostId, result.file)
    } catch (err) {
      if (request !== browseRequest || !browse || browse.hostId !== hostId) return
      browse = { ...browse, error: message(err) }
    } finally {
      if (request === browseRequest) busy = false
    }
  }

  function orderTabs(files: RememberedFile[]): void {
    const rank = new Map(files.map((file, index) => [tabKey(file.hostId, file.path), index]))
    tabs = [...tabs].sort(
      (a, b) => (rank.get(tabKey(a.hostId, a.path)) ?? tabs.length) - (rank.get(tabKey(b.hostId, b.path)) ?? tabs.length)
    )
  }

  function moveTab(fromKey: string, toKey: string, after: boolean): void {
    if (fromKey === toKey) return
    const next = [...tabs]
    const fromIndex = next.findIndex((tab) => tabKey(tab.hostId, tab.path) === fromKey)
    if (fromIndex < 0) return
    const [moved] = next.splice(fromIndex, 1)
    let toIndex = next.findIndex((tab) => tabKey(tab.hostId, tab.path) === toKey)
    if (toIndex < 0 || !moved) return
    if (after) toIndex += 1
    next.splice(toIndex, 0, moved)
    tabs = next
    persistOpenFiles()
  }

  function tabDragStart(event: DragEvent, key: string): void {
    dragKey = key
    document.body.classList.add('tab-dragging')
    event.dataTransfer?.setData('text/plain', key)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }

  function tabDragOver(event: DragEvent): void {
    if (!dragKey) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  function tabDrop(event: DragEvent, key: string): void {
    event.preventDefault()
    const from = dragKey
    dragKey = null
    if (!from) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    moveTab(from, key, event.clientX > rect.left + rect.width / 2)
  }

  function focusFile(hostId: string, path: string): void {
    const key = tabKey(hostId, path)
    if (activeKey && activeKey !== key) recentKey = activeKey
    activeKey = key
    selection = { kind: 'file', hostId, path }
  }

  function showTab(hostId: string, path: string): void {
    focusFile(hostId, path)
    revealFile(hostId, path)
  }

  function selectFile(hostId: string, path: string): void {
    if (tabs.some((tab) => tab.hostId === hostId && tab.path === path)) showTab(hostId, path)
    else selection = { kind: 'file', hostId, path }
  }

  function showTabAt(index: number): void {
    const tab = tabs[index]
    if (tab) showTab(tab.hostId, tab.path)
  }

  function toggleRecentTab(): void {
    if (!recentKey || recentKey === activeKey) return
    const tab = tabs.find((item) => tabKey(item.hostId, item.path) === recentKey)
    if (!tab) {
      recentKey = null
      return
    }
    showTab(tab.hostId, tab.path)
  }

  async function openRemote(hostId: string, path: string, rememberOpen = true, focus = true): Promise<void> {
    const key = tabKey(hostId, path)
    const existing = tabs.find((tab) => tabKey(tab.hostId, tab.path) === key)
    if (existing) {
      browse = null
      if (focus) focusFile(hostId, path)
      if (rememberOpen) {
        revealFile(hostId, path)
        persistOpenFiles()
      }
      return
    }
    busy = true
    banner = ''
    try {
      const loaded = await window.api.file.read(hostId, path)
      setHostStatus(hostId, 'connected')
      project = await window.api.file.remember(hostId, path)
      if (!tabs.some((tab) => tabKey(tab.hostId, tab.path) === key)) {
        tabs = [...tabs, {
          hostId,
          path,
          text: loaded.text,
          dirty: false,
          writable: loaded.writable,
          lineEnding: loaded.lineEnding,
          size: loaded.size,
          mtime: loaded.mtime
        }]
        setFileError(hostId, path, null)
      }
      browse = null
      if (focus) {
        focusFile(hostId, path)
        side = 'files'
      }
      if (rememberOpen) {
        revealFile(hostId, path)
        persistOpenFiles()
      }
    } catch (err) {
      const text = message(err)
      setFileError(hostId, path, text)
      if (browse) browse = { ...browse, error: text }
      else banner = text
    } finally {
      busy = false
    }
  }

  function closeTab(hostId: string, path: string): void {
    const key = tabKey(hostId, path)
    const wasActive = activeKey === key
    tabs = tabs.filter((tab) => tabKey(tab.hostId, tab.path) !== key)
    setFileError(hostId, path, null)
    if (recentKey === key) recentKey = null
    if (wasActive) {
      const next = tabs[tabs.length - 1]
      activeKey = next ? tabKey(next.hostId, next.path) : null
      if (next) {
        selection = { kind: 'file', hostId: next.hostId, path: next.path }
        revealFile(next.hostId, next.path)
        side = 'files'
      } else {
        selection = { kind: 'host', hostId }
      }
    } else if (selection?.kind === 'file' && selection.hostId === hostId && selection.path === path) {
      const current = tabs.find((tab) => tabKey(tab.hostId, tab.path) === activeKey)
      if (current) {
        selection = { kind: 'file', hostId: current.hostId, path: current.path }
        revealFile(current.hostId, current.path)
        side = 'files'
      } else {
        selection = { kind: 'host', hostId }
      }
    }
    persistOpenFiles()
  }

  async function forgetSelectedFile(): Promise<void> {
    if (selection?.kind !== 'file') return
    const { hostId, path } = selection
    if (isDirty(hostId, path) && !confirm(`Discard unsaved edits in ${fileName(path)} and remove it from the project?`)) return
    pendingOpen = pendingOpen.filter((file) => file.hostId !== hostId || file.path !== path)
    busy = true
    try {
      project = await window.api.file.forget(hostId, path)
      closeTab(hostId, path)
      selection = { kind: 'host', hostId }
    } catch (err) {
      banner = message(err)
    } finally {
      busy = false
    }
  }

  function editText(hostId: string, path: string, text: string): void {
    const key = tabKey(hostId, path)
    saveNote = ''
    tabs = tabs.map((tab) => (tabKey(tab.hostId, tab.path) === key ? { ...tab, text, dirty: true } : tab))
  }

  async function saveTab(tab: Tab): Promise<boolean> {
    if (tab.writable === false) return false
    try {
      const saved = await window.api.file.write(tab.hostId, tab.path, tab.text, { size: tab.size, mtime: tab.mtime })
      const key = tabKey(tab.hostId, tab.path)
      tabs = tabs.map((item) =>
        tabKey(item.hostId, item.path) === key ? { ...item, dirty: false, size: saved.size, mtime: saved.mtime } : item
      )
      setFileError(tab.hostId, tab.path, null)
      return saved.inPlace
    } catch (err) {
      const text = message(err)
      if (text !== 'Save cancelled.') setFileError(tab.hostId, tab.path, text)
      throw err
    }
  }

  async function saveActive(): Promise<void> {
    if (saving || !activeTab?.dirty || activeTab.writable === false) return
    saving = true
    busy = true
    banner = ''
    try {
      const inPlace = await saveTab(activeTab)
      saveNote = inPlace ? 'Saved in place' : ''
    } catch (err) {
      banner = message(err)
    } finally {
      saving = false
      busy = false
    }
  }

  async function saveAll(): Promise<void> {
    const dirty = tabs.filter((tab) => tab.dirty && tab.writable !== false)
    if (saving || dirty.length === 0) return
    saving = true
    busy = true
    banner = ''
    let inPlace = false
    const problems: string[] = []
    try {
      for (const tab of dirty) {
        const current = tabs.find((item) => tab.hostId === item.hostId && tab.path === item.path) ?? tab
        if (!current.dirty) continue
        try {
          if (await saveTab(current)) inPlace = true
        } catch (err) {
          problems.push(message(err))
        }
      }
      saveNote = inPlace ? 'Saved in place' : ''
      if (problems.length) banner = problems.join('\n')
    } finally {
      saving = false
      busy = false
    }
  }

  function closeActiveTab(): void {
    if (activeTab) closeTab(activeTab.hostId, activeTab.path)
  }

  function closeAllTabs(): void {
    if (tabs.length === 0) return
    if (hasDirty() && !confirm('Discard unsaved edits and close all tabs?')) return
    for (const tab of tabs) setFileError(tab.hostId, tab.path, null)
    tabs = []
    activeKey = null
    recentKey = null
    persistOpenFiles()
  }

  async function duplicateSelected(): Promise<void> {
    if (!listHost) return
    busy = true
    banner = ''
    try {
      const copied = await window.api.host.duplicate(listHost.id)
      hosts = copied.hosts
      selection = { kind: 'host', hostId: copied.host.id }
      side = 'hosts'
    } catch (err) {
      banner = message(err)
    } finally {
      busy = false
    }
  }

  function beginEditHost(): void {
    if (listHost) hostDialog = { mode: 'edit', host: listHost }
  }

  async function openSettings(): Promise<void> {
    try {
      const settings = await window.api.settings.get()
      updateChannel = settings.updateChannel
      settingsOpen = true
    } catch (err) {
      banner = message(err)
    }
  }

  async function checkUpdates(channel: UpdateChannel): Promise<void> {
    busy = true
    try {
      await window.api.settings.save({ updateChannel: channel })
      updateChannel = channel
      await window.api.app.checkForUpdates()
    } catch (err) {
      banner = message(err)
    } finally {
      busy = false
    }
  }

  async function saveSettings(channel: UpdateChannel): Promise<void> {
    busy = true
    try {
      await window.api.settings.save({ updateChannel: channel })
      updateChannel = channel
      settingsOpen = false
    } catch (err) {
      banner = message(err)
    } finally {
      busy = false
    }
  }

  function runMenu(command: MenuCommand): void {
    if (browse || hostDialog || settingsOpen) return
    if (command === 'project:new') void newProject()
    else if (command === 'project:open') void openProject()
    else if (command === 'file:save') void saveActive()
    else if (command === 'file:save-all') void saveAll()
    else if (command === 'file:close') closeActiveTab()
    else if (command === 'file:close-all') closeAllTabs()
    else if (command === 'host:add') void beginAddHost()
    else if (command === 'host:edit') beginEditHost()
    else if (command === 'host:duplicate') void duplicateSelected()
    else if (command === 'host:remove') void removeSelectedHost()
    else if (command === 'host:connect') void connectSelected()
    else if (command === 'host:disconnect') void disconnectSelected()
    else if (command === 'file:open') void openBrowse()
    else if (command === 'file:remove') void forgetSelectedFile()
    else if (command === 'app:settings') void openSettings()
    else if (command === 'app:check-updates') void window.api.app.checkForUpdates()
  }
</script>

<div class="flex h-full flex-col">
  {#if banner}
    <div class="flex items-start justify-between gap-3 border-b border-line bg-tab px-3 py-2 text-sm text-bad">
      <span class="whitespace-pre-wrap">{banner}</span>
      <button class="btn" onclick={() => (banner = '')}>Dismiss</button>
    </div>
  {/if}

  <div class="flex min-h-0 flex-1">
    {#snippet hostRow(host: HostProfile, foldable: boolean)}
      {@const folded = foldable && hostFolded(host.id)}
      {@const selected = selection?.kind === 'host' && selection.hostId === host.id}
      <div class="flex w-full min-w-0 items-center hover:bg-ink {selected ? 'bg-ink' : ''}">
        {#if foldable}
          <button
            class="shrink-0 cursor-default px-2 leading-5"
            type="button"
            aria-label={folded ? 'Expand' : 'Collapse'}
            onclick={() => toggleHost(host.id)}
          >
            <span class="font-mono text-[17px] leading-none text-slate-500">{folded ? '▸' : '▾'}</span>
          </button>
        {/if}
        <button
          class="flex min-w-0 flex-1 items-center gap-2 text-left text-sm leading-5 {foldable ? 'pr-2' : 'px-2 py-0.5'} {selected
            ? 'text-accent'
            : ''}"
          type="button"
          title="Double-click to open a file"
          onclick={() => (selection = { kind: 'host', hostId: host.id })}
          ondblclick={() => void openBrowseFor(host)}
        >
          <span
            class="h-2 w-2 shrink-0 rounded-full {statusOf(host.id) === 'connected'
              ? 'bg-ok'
              : statusOf(host.id) === 'connecting'
                ? 'bg-warn'
                : statusOf(host.id) === 'failed'
                  ? 'bg-bad'
                  : 'bg-slate-500'}"
          ></span>
          <span class="min-w-0 truncate">{host.displayName}</span>
        </button>
      </div>
    {/snippet}

    <aside class="flex w-80 shrink-0 flex-col border-r border-line bg-panel">
      <div class="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-1">
        <ToolButton label="New project" icon="new-project" onclick={() => void newProject()} />
        <ToolButton label="Open project" icon="open-project" onclick={() => void openProject()} />
        <span class="mx-0.5 h-4 w-px shrink-0 bg-line"></span>
        <ToolButton label="Add host" icon="add-host" onclick={() => void beginAddHost()} />
        <ToolButton label="Edit host" icon="edit" disabled={!listHost} onclick={beginEditHost} />
        <ToolButton label="Duplicate host" icon="duplicate" disabled={!listHost || busy} onclick={() => void duplicateSelected()} />
        <ToolButton
          label="Connect"
          icon="connect"
          disabled={!listHost || statusOf(listHost.id) === 'connecting' || statusOf(listHost.id) === 'connected'}
          onclick={() => void connectSelected()}
        />
        <ToolButton
          label="Disconnect"
          icon="disconnect"
          disabled={!listHost || statusOf(listHost.id) !== 'connected'}
          onclick={() => void disconnectSelected()}
        />
        <ToolButton label="Open file" icon="open-file" disabled={!project || !listHost || busy} onclick={() => void openBrowse()} />
        <ToolButton label="Close all tabs" icon="close-all" disabled={tabs.length === 0} onclick={closeAllTabs} />
        <span class="mx-0.5 h-4 w-px shrink-0 bg-line"></span>
        <ToolButton label="Remove host" icon="remove-host" disabled={!listHost} onclick={() => void removeSelectedHost()} />
        <ToolButton label="Remove file" icon="remove-file" disabled={selection?.kind !== 'file'} onclick={() => void forgetSelectedFile()} />
        <span class="mx-0.5 h-4 w-px shrink-0 bg-line"></span>
        <ToolButton label="Settings" icon="settings" onclick={() => void openSettings()} />
      </div>
      <div class="flex border-b border-line">
        <button
          class="flex-1 px-2 py-1.5 text-sm {side === 'hosts' ? 'bg-ink text-accent' : 'text-slate-300 hover:bg-ink'}"
          type="button"
          onclick={() => (side = 'hosts')}
        >
          Hosts
        </button>
        <button
          class="flex-1 border-l border-line px-2 py-1.5 text-sm {side === 'files' ? 'bg-ink text-accent' : 'text-slate-300 hover:bg-ink'}"
          type="button"
          onclick={() => (side = 'files')}
        >
          Files
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-auto p-2">
        {#if side === 'hosts'}
          {#if hosts.length === 0}
            <p class="px-2 py-3 text-sm text-slate-400">No hosts yet. Add one, or fill it from SSH config.</p>
          {:else}
            {#each hosts as host (host.id)}
              {@render hostRow(host, false)}
            {/each}
          {/if}
        {:else if !project}
          <p class="px-2 py-3 text-sm text-slate-400">Open a project to remember files.</p>
        {:else if fileGroups.length === 0}
          <p class="px-2 py-3 text-sm text-slate-400">No files yet.</p>
        {:else}
          {#each fileGroups as group (group.host.id)}
            <section class={hostFolded(group.host.id) ? 'mb-1' : 'mb-3'}>{@render hostRow(group.host, true)}{#if !hostFolded(group.host.id)}<FileTree
                nodes={buildTree(group.paths)}
                collapsed={collapsedPaths(group.host.id)}
                selectedPath={selection?.kind === 'file' && selection.hostId === group.host.id ? selection.path : null}
                dirty={(path) => isDirty(group.host.id, path)}
                error={(path) => fileErrors[tabKey(group.host.id, path)] ?? ''}
                titleFor={(path) => identity(group.host, path)}
                onSelect={(path) => selectFile(group.host.id, path)}
                onOpen={(path) => void openRemote(group.host.id, path)}
                onOpenDir={(path) => void openBrowseAt(group.host.id, path)}
                onCollapsed={(paths) => setCollapsed(group.host.id, paths)}
              />{/if}</section>
          {/each}
        {/if}
      </div>
    </aside>

    <main class="flex min-w-0 flex-1 flex-col">
      <div class="flex h-9 shrink-0 items-center gap-0.5 border-b border-line bg-panel px-1">
        <ToolButton
          label="Save (Ctrl+S)"
          icon="save"
          accent
          disabled={!activeTab?.dirty || activeTab.writable === false || busy}
          onclick={() => void saveActive()}
        />
        <ToolButton
          label="Save all (Ctrl+Shift+S)"
          icon="save-all"
          disabled={!tabs.some((tab) => tab.dirty && tab.writable !== false) || busy}
          onclick={() => void saveAll()}
        />
      </div>
      <div
        class="flex flex-nowrap gap-1 overflow-x-auto overflow-y-hidden border-b border-line bg-ink px-2 pt-2"
        role="list"
        bind:this={tabStrip}
        onwheel={scrollTabStrip}
      >
        {#each tabs as tab (tabKey(tab.hostId, tab.path))}
          {@const host = hosts.find((item) => item.id === tab.hostId)}
          {@const key = tabKey(tab.hostId, tab.path)}
          <div
            class="flex max-w-56 shrink-0 items-center gap-2 rounded-t border border-b-0 px-2 py-1 text-sm {activeKey ===
            key
              ? 'border-line border-t-accent bg-panel text-white shadow-[inset_0_2px_0_0_var(--color-accent)]'
              : 'border-transparent text-slate-500 hover:text-slate-300'} {dragKey === key ? 'opacity-40' : ''}"
            role="listitem"
            data-active-tab={activeKey === key ? 'true' : undefined}
            ondragover={tabDragOver}
            ondrop={(event) => tabDrop(event, key)}
          >
            <button
              class="min-w-0 flex-1 truncate text-left active:cursor-grabbing"
              draggable="true"
              ondragstart={(event) => tabDragStart(event, key)}
              ondragend={() => {
                dragKey = null
                document.body.classList.remove('tab-dragging')
              }}
              title={host ? identity(host, tab.path) : tab.path}
              onclick={() => showTab(tab.hostId, tab.path)}
            >
              {fileName(tab.path)}
            </button>
            {#if fileErrors[key]}
              <span class="size-2.5 shrink-0 rounded-full bg-bad" title={fileErrors[key]} aria-label={fileErrors[key]}></span>
            {/if}
            {#if tab.dirty}
              <span class="size-2.5 shrink-0 rounded-full bg-warn" title="Unsaved changes" aria-label="Unsaved changes"></span>
            {/if}
            <button
              class="text-slate-400 hover:text-white"
              data-close-tab
              title="Close tab"
              onclick={() => closeTab(tab.hostId, tab.path)}
            >×</button>
          </div>
        {/each}
      </div>
      <div class="relative min-h-0 flex-1">
        {#each tabs as tab (tabKey(tab.hostId, tab.path))}
          {@const key = tabKey(tab.hostId, tab.path)}
          <div class="absolute inset-0 {key === activeKey ? 'z-10' : 'invisible pointer-events-none'}">
            <EditorTab
              path={tab.path}
              text={tab.text}
              active={key === activeKey}
              readOnly={tab.writable === false}
              onChange={(text) => editText(tab.hostId, tab.path, text)}
              onSave={() => void saveActive()}
              onCursor={(line, column) => {
                if (key === activeKey) cursor = { line, column }
              }}
            />
          </div>
        {/each}
        {#if !activeTab}
          <div class="flex h-full items-center justify-center text-sm text-slate-500">
            {project ? 'Open a file from a host.' : 'No project open.'}
          </div>
        {/if}
      </div>
      <footer class="flex min-w-0 items-center justify-between gap-3 border-t border-line bg-panel px-3 py-1 text-xs text-slate-300">
        <span class="min-w-0 flex-1 truncate">
          {#if activeTab && selectedHost && activeTab.hostId === selectedHost.id}
            {identity(selectedHost, activeTab.path)}
          {:else if activeTab}
            {@const host = hosts.find((item) => item.id === activeTab.hostId)}
            {host ? identity(host, activeTab.path) : activeTab.path}
          {:else if selectedHost}
            {selectedHost.displayName}
          {/if}
        </span>
        <span class="flex shrink-0 items-center gap-3">
          {#if activeTab?.writable === false}
            <span>read-only</span>
          {/if}
          {#if activeTab}
            <span>UTF-8</span>
            <span>{activeTab.lineEnding}</span>
            <span>{statusOf(activeTab.hostId)}</span>
          {:else if selectedHost}
            <span>{statusOf(selectedHost.id)}</span>
          {/if}
          {#if saveNote}
            <span>{saveNote}</span>
          {/if}
          <span>{activeTab ? `${cursor.line}:${cursor.column}` : ''}</span>
          <button class="shrink-0 font-mono text-slate-100 hover:text-white" title="Check for updates" onclick={() => void window.api.app.checkForUpdates()}>
            {appVersion ? `v${appVersion}` : ''}
          </button>
        </span>
      </footer>
    </main>
  </div>
</div>

{#if settingsOpen}
  <SettingsDialog
    channel={updateChannel}
    {busy}
    onCancel={() => (settingsOpen = false)}
    onSave={(channel) => void saveSettings(channel)}
    onCheck={(channel) => void checkUpdates(channel)}
  />
{/if}

{#if hostDialog}
  <HostDialog
    mode={hostDialog.mode}
    host={hostDialog.host}
    {encryptionAvailable}
    {busy}
    error={hostError}
    {sshHosts}
    onBrowseKey={() => window.api.pickKeyFile()}
    onCancel={() => {
      hostDialog = null
      hostError = ''
    }}
    onSave={(input) => void saveHost(input)}
  />
{/if}

{#if browse}
  {@const current = browse}
  {@const host = hosts.find((item) => item.id === current.hostId)}
  <BrowseDialog
    hostLabel={host?.displayName ?? 'host'}
    path={current.path}
    entries={current.entries}
    {busy}
    error={current.error}
    onNavigate={(path) => void navigate(path)}
    onOpen={(path) => void openRemote(current.hostId, path)}
    onClose={() => (browse = null)}
  />
{/if}
