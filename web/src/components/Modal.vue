<script setup>
defineProps({
  title: { type: String, required: true },
  wide: { type: Boolean, default: false },
});
defineEmits(['close']);
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="$emit('close')">
      <div class="modal" :class="{ wide }">
        <header>
          <h3>{{ title }}</h3>
          <div class="modal-head-extra"><slot name="header-extra" /></div>
          <button class="close" aria-label="Close" @click="$emit('close')">✕</button>
        </header>
        <div class="modal-body"><slot /></div>
        <footer v-if="$slots.footer"><slot name="footer" /></footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; background: rgba(10,28,26,0.45); z-index: 90;
  display: flex; align-items: flex-start; justify-content: center; padding: 5vh 16px; overflow-y: auto;
}
.modal {
  background: #fff; border-radius: 16px; width: 100%; max-width: 560px;
  box-shadow: 0 24px 64px rgba(10,28,26,0.3); animation: pop 0.16s ease-out;
}
.modal.wide { max-width: 860px; }
@keyframes pop { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
header { display: flex; align-items: center; gap: 10px; padding: 16px 20px 12px; border-bottom: 1px solid var(--line); }
header h3 { font: 700 16px var(--font-ui); margin-right: auto; }
.close {
  border: none; background: #f2f6f5; color: var(--muted); width: 30px; height: 30px;
  border-radius: 8px; cursor: pointer; font-size: 13px;
}
.close:hover { background: #e4eeec; color: var(--ink); }
.modal-body { padding: 16px 20px; }
footer { padding: 12px 20px 16px; border-top: 1px solid var(--line); display: flex; gap: 10px; justify-content: flex-end; }
</style>
