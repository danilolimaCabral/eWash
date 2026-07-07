<script setup>
// THE button. Every button in the app goes through this component so styling
// stays consistent. Usage:
//   <BaseButton icon="plus" @click="...">New order</BaseButton>
//   <BaseButton variant="danger" size="sm" :loading="busy">Void</BaseButton>
import AppIcon from './AppIcon.vue';

defineProps({
  variant: { type: String, default: 'primary' }, // primary | ghost | green | danger | text
  size: { type: String, default: 'md' }, // md | sm
  icon: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  block: { type: Boolean, default: false }, // full width
  type: { type: String, default: 'button' },
});
</script>

<template>
  <button
    class="btn"
    :class="[`btn-${variant}`, { 'btn-sm': size === 'sm', 'btn-block': block }]"
    :type="type"
    :disabled="disabled || loading"
  >
    <span v-if="loading" class="spin" aria-hidden="true" />
    <AppIcon v-else-if="icon" :name="icon" :size="size === 'sm' ? 13 : 15" />
    <slot />
  </button>
</template>

<style scoped>
/* base .btn styles come from the global stylesheet; only extras live here */
.btn-block { width: 100%; justify-content: center; }
.btn-text { background: none; border: none; color: var(--brand); padding: 4px 6px; box-shadow: none; }
.btn-text:hover:not(:disabled) { background: var(--brand-light); }
.spin {
  width: 13px; height: 13px; flex-shrink: 0; border-radius: 50%;
  border: 2px solid currentColor; border-top-color: transparent;
  animation: rotate 0.7s linear infinite;
}
@keyframes rotate { to { transform: rotate(360deg); } }
</style>
