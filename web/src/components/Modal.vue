<script setup>
// Accessible modal shell with a fixed header/footer and independently scrolling body.
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import AppIcon from './AppIcon.vue';

const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  wide: { type: Boolean, default: false },
  size: { type: String, default: '' }, // standard | wide | workspace
  closeOnBackdrop: { type: Boolean, default: true },
});
const emit = defineEmits(['close']);
const dialog = ref(null);
const titleId = `modal-title-${Math.random().toString(36).slice(2)}`;
let previousFocus;

function close() { emit('close'); }
function onKeydown(event) {
  if (event.key === 'Escape') close();
}
function backdrop(event) {
  if (props.closeOnBackdrop && event.target === event.currentTarget) close();
}

onMounted(async () => {
  previousFocus = document.activeElement;
  document.addEventListener('keydown', onKeydown);
  document.body.classList.add('modal-open');
  await nextTick();
  const first = dialog.value?.querySelector('.modal-body input:not([disabled]), .modal-body select:not([disabled]), .modal-body textarea:not([disabled]), .modal-body button:not([disabled]), .modal-body a[href]');
  (first || dialog.value)?.focus();
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  queueMicrotask(() => {
    if (!document.querySelector('.overlay')) document.body.classList.remove('modal-open');
  });
  previousFocus?.focus?.();
});
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @mousedown.self="backdrop">
      <section ref="dialog" class="modal" :class="[size || (wide ? 'wide' : 'standard')]"
        role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
        <header>
          <div class="modal-title">
            <h3 :id="titleId">{{ title }}</h3>
            <p v-if="subtitle">{{ subtitle }}</p>
          </div>
          <div class="modal-head-extra"><slot name="header-extra" /></div>
          <button class="close" aria-label="Close" @click="close"><AppIcon name="x" :size="14" /></button>
        </header>
        <div class="modal-body"><slot /></div>
        <footer v-if="$slots.footer"><slot name="footer" /></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; background: var(--overlay); z-index: 90;
  display: flex; align-items: center; justify-content: center; padding: 24px;
  backdrop-filter: blur(2px);
}
.modal {
  display: flex; flex-direction: column; width: 100%; max-height: min(820px, calc(100vh - 48px));
  background: var(--card); border-radius: var(--radius-lg); overflow: hidden; outline: none;
  box-shadow: var(--shadow-modal); animation: pop 0.16s ease-out;
}
.modal.standard { max-width: 560px; }
.modal.wide { max-width: 860px; }
.modal.workspace { max-width: 1040px; }
@keyframes pop { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
header { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--line); }
.modal-title { flex: 1; min-width: 0; }
header h3 { font: 700 16px var(--font-ui); }
header p { margin-top: 2px; color: var(--muted); font-size: 10.5px; }
.modal-head-extra { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.close {
  display: grid; place-items: center; flex: 0 0 auto; border: none; background: #f2f6f5; color: var(--muted); width: 30px; height: 30px;
  border-radius: var(--radius-sm); cursor: pointer;
}
.close:hover { background: var(--brand-light); color: var(--ink); }
.modal-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 16px 18px; overscroll-behavior: contain; }
footer { flex: 0 0 auto; padding: 11px 18px; border-top: 1px solid var(--line); background: #fbfcfc; display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
@media (max-width: 640px) {
  .overlay { align-items: flex-end; padding: 0; }
  .modal, .modal.standard, .modal.wide, .modal.workspace {
    max-width: none; max-height: calc(100dvh - 18px); border-radius: 16px 16px 0 0;
    animation-name: sheet;
  }
  @keyframes sheet { from { transform: translateY(20px); opacity: 0; } to { transform: none; opacity: 1; } }
  header { padding: 13px 14px; }
  .modal-body { padding: 14px; }
  footer { padding: 10px 14px calc(10px + env(safe-area-inset-bottom)); }
  footer :deep(.btn) { flex: 1; justify-content: center; }
}
</style>
