<script setup>
// In-app replacement for window.confirm — raw browser dialogs are banned.
// Usage:
//   <ConfirmDialog v-if="confirming" title="Void order?" :message="..."
//     confirm-label="Void it" danger @confirm="doIt" @close="confirming = false" />
import Modal from './Modal.vue';
import BaseButton from './BaseButton.vue';
import AppIcon from './AppIcon.vue';

defineProps({
  title: { type: String, required: true },
  message: { type: String, default: '' },
  confirmLabel: { type: String, default: 'Confirm' },
  cancelLabel: { type: String, default: 'Cancel' },
  danger: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
});
defineEmits(['confirm', 'close']);
</script>

<template>
  <Modal :title="title" :close-on-backdrop="!busy" @close="$emit('close')">
    <div class="confirm-layout" :class="{ danger }">
      <span class="confirm-icon"><AppIcon :name="danger ? 'alert' : 'help'" :size="22" /></span>
      <div><p class="confirm-message">{{ message }}</p><slot /></div>
    </div>
    <template #footer>
      <BaseButton variant="ghost" :disabled="busy" @click="$emit('close')">{{ cancelLabel }}</BaseButton>
      <BaseButton :variant="danger ? 'danger' : 'primary'" :loading="busy" @click="$emit('confirm')">
        {{ confirmLabel }}
      </BaseButton>
    </template>
  </Modal>
</template>

<style scoped>
.confirm-layout { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; align-items: start; }
.confirm-icon { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 11px; color: var(--brand); background: var(--brand-light); }
.confirm-layout.danger .confirm-icon { color: var(--red); background: #fdf1f0; }
.confirm-message { font-size: 13.5px; color: #45535a; margin: 2px 0 4px; }
</style>
