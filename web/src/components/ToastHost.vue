<script setup>
import { useToast } from '../stores/toast.js';

const toast = useToast();
</script>

<template>
  <Teleport to="body">
    <div class="toasts">
      <TransitionGroup name="toast">
        <div
          v-for="t in toast.items" :key="t.id"
          class="toast" :class="t.kind"
          @click="toast.dismiss(t.id)"
        >{{ t.message }}</div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toasts { position: fixed; bottom: 24px; right: 24px; z-index: 99; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
.toast {
  background: var(--ink); color: #fff; padding: 12px 18px; border-radius: 10px;
  font-size: 13px; box-shadow: 0 6px 24px rgba(0,0,0,0.25); max-width: 380px; cursor: pointer;
}
.toast.success { background: #17564a; }
.toast.error { background: #8c3a31; }
.toast-enter-active, .toast-leave-active { transition: all 0.25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(8px); }
</style>
