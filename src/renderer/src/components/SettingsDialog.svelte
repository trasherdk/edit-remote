<script lang="ts">
  import type { UpdateChannel } from '@shared/types'
  import { untrack } from 'svelte'

  let {
    channel,
    busy,
    onCancel,
    onSave
  }: {
    channel: UpdateChannel
    busy: boolean
    onCancel: () => void
    onSave: (channel: UpdateChannel) => void
  } = $props()

  let picked = $state<UpdateChannel>(untrack(() => channel))
</script>

<div class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6">
  <form
    class="w-full max-w-md space-y-4 rounded-lg border border-line bg-panel p-4 shadow-xl"
    onsubmit={(event) => {
      event.preventDefault()
      onSave(picked)
    }}
  >
    <h2 class="text-base font-medium">Settings</h2>
    <fieldset class="space-y-3">
      <legend class="mb-2 text-sm text-slate-300">Updates</legend>
      <label class="flex items-start gap-2 text-sm">
        <input class="mt-1" type="radio" name="update-channel" value="stable" bind:group={picked} />
        <span>
          <span class="block">Stable</span>
          <span class="block text-xs text-slate-400">Published releases only.</span>
        </span>
      </label>
      <label class="flex items-start gap-2 text-sm">
        <input class="mt-1" type="radio" name="update-channel" value="prerelease" bind:group={picked} />
        <span>
          <span class="block">Beta and release candidates</span>
          <span class="block text-xs text-slate-400">Also offer beta and rc builds. A stable release of the same version is still newer.</span>
        </span>
      </label>
    </fieldset>
    <p class="text-xs text-slate-400">Packaged builds check on startup and when the version in the status bar is clicked.</p>
    <div class="flex justify-end gap-2 pt-1">
      <button class="btn" type="button" onclick={onCancel} disabled={busy}>Cancel</button>
      <button class="btn btn-accent" type="submit" disabled={busy}>Save</button>
    </div>
  </form>
</div>
