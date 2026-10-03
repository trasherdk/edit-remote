<script lang="ts">
  import type { HostInput, HostProfile, SshConfigHost } from '@shared/types'
  import { untrack } from 'svelte'

  let {
    mode,
    host,
    encryptionAvailable,
    busy,
    error,
    sshHosts,
    onBrowseKey,
    onCancel,
    onSave
  }: {
    mode: 'add' | 'edit'
    host: HostProfile | null
    encryptionAvailable: boolean
    busy: boolean
    error: string
    sshHosts: SshConfigHost[]
    onBrowseKey: () => Promise<string | null>
    onCancel: () => void
    onSave: (input: HostInput) => void
  } = $props()

  const initial = untrack(() => host)
  let displayName = $state(initial?.displayName ?? '')
  let hostname = $state(initial?.hostname ?? '')
  let port = $state(initial?.port ?? 22)
  let username = $state(initial?.username ?? '')
  let keyPath = $state(initial?.keyPath ?? '')
  let passphrase = $state('')
  let clearPassphrase = $state(false)
  let defaultDirectory = $state(initial?.defaultDirectory ?? '')

  function applySsh(alias: string): void {
    const picked = sshHosts.find((item) => item.alias === alias)
    if (!picked) return
    displayName = picked.alias
    hostname = picked.hostname
    port = picked.port
    username = picked.username
    keyPath = picked.keyPath
  }

  async function browse(): Promise<void> {
    const picked = await onBrowseKey()
    if (picked) keyPath = picked
  }

  function submit(): void {
    onSave({
      id: host?.id,
      displayName,
      hostname,
      port: Number(port),
      username,
      keyPath,
      passphrase,
      clearPassphrase,
      defaultDirectory
    })
  }
</script>

<div class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6">
  <form
    class="w-full max-w-lg space-y-3 rounded-lg border border-line bg-panel p-4 shadow-xl"
    onsubmit={(event) => {
      event.preventDefault()
      submit()
    }}
  >
    <h2 class="text-base font-medium">{mode === 'add' ? 'Add SFTP host' : 'Edit host'}</h2>
    {#if mode === 'add' && sshHosts.length > 0}
      <label class="block text-sm">
        <span class="mb-1 block text-slate-300">SSH config</span>
        <select class="field" onchange={(event) => applySsh(event.currentTarget.value)}>
          <option value="">Fill from ~/.ssh/config…</option>
          {#each sshHosts as item (item.alias)}
            <option value={item.alias}>{item.alias} ({item.username}@{item.hostname})</option>
          {/each}
        </select>
      </label>
    {/if}
    <label class="block text-sm">
      <span class="mb-1 block text-slate-300">Display name</span>
      <input class="field" bind:value={displayName} />
    </label>
    <div class="grid grid-cols-[1fr_6rem] gap-3">
      <label class="block text-sm">
        <span class="mb-1 block text-slate-300">Hostname</span>
        <input class="field" bind:value={hostname} required />
      </label>
      <label class="block text-sm">
        <span class="mb-1 block text-slate-300">Port</span>
        <input class="field" type="number" min="1" max="65535" bind:value={port} required />
      </label>
    </div>
    <label class="block text-sm">
      <span class="mb-1 block text-slate-300">Username</span>
      <input class="field" bind:value={username} required />
    </label>
    <label class="block text-sm">
      <span class="mb-1 block text-slate-300">Private key</span>
      <span class="flex gap-2">
        <input class="field" bind:value={keyPath} required />
        <button class="btn shrink-0" type="button" onclick={() => void browse()}>Browse</button>
      </span>
    </label>
    <label class="block text-sm">
      <span class="mb-1 block text-slate-300">Key passphrase</span>
      <input class="field" type="password" autocomplete="off" bind:value={passphrase} />
    </label>
    {#if host?.hasPassphrase}
      <label class="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" bind:checked={clearPassphrase} />
        Clear the saved passphrase
      </label>
      <p class="text-xs text-slate-400">Leave the field blank to keep the saved passphrase.</p>
    {/if}
    {#if !encryptionAvailable}
      <p class="text-xs text-warn">A passphrase cannot be stored on this system. Use a key that is not encrypted.</p>
    {/if}
    <label class="block text-sm">
      <span class="mb-1 block text-slate-300">Default directory</span>
      <input class="field" placeholder="/var/www" bind:value={defaultDirectory} />
    </label>
    {#if error}
      <p class="text-sm text-bad">{error}</p>
    {/if}
    <div class="flex justify-end gap-2 pt-1">
      <button class="btn" type="button" onclick={onCancel} disabled={busy}>Cancel</button>
      <button class="btn btn-accent" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save host'}</button>
    </div>
  </form>
</div>
