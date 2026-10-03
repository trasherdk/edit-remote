<script lang="ts">
  import Icon from './Icon.svelte'

  let {
    label,
    icon,
    disabled = false,
    accent = false,
    onclick
  }: {
    label: string
    icon: string
    disabled?: boolean
    accent?: boolean
    onclick: () => void
  } = $props()
</script>

<button
  class="tool {accent ? 'tool-accent' : ''}"
  type="button"
  title={label}
  aria-label={label}
  {disabled}
  {onclick}
>
  <Icon name={icon} />
</button>
