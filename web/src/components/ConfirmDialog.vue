<script setup>
// In-app replacement for window.confirm — raw browser dialogs are banned.
// Usage:
//   <ConfirmDialog v-if="confirming" title="Void order?" :message="..."
//     confirm-label="Void it" danger @confirm="doIt" @close="confirming = false" />
import Modal from './Modal.vue';
import BaseButton from './BaseButton.vue';

defineProps({
  title: { type: String, required: true },
  message: { type: String, default: '' },
  confirmLabel: { type: String, default: 'Confirmar' },
  cancelLabel: { type: String, default: 'Cancelar' },
  danger: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
});
defineEmits(['confirm', 'close']);
</script>

<template>
  <Modal :title="title" @close="$emit('close')">
    <p class="confirm-message">{{ message }}</p>
    <slot />
    <template #footer>
      <BaseButton variant="ghost" @click="$emit('close')">{{ cancelLabel }}</BaseButton>
      <BaseButton :variant="danger ? 'danger' : 'primary'" :loading="busy" @click="$emit('confirm')">
        {{ confirmLabel }}
      </BaseButton>
    </template>
  </Modal>
</template>

<style scoped>
.confirm-message { font-size: 13.5px; color: #45535a; margin: 2px 0 4px; }
</style>
