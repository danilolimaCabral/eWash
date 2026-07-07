<script setup>
import AppIcon from './AppIcon.vue';

defineProps({
  icon: { type: String, default: 'orders' },
  title: { type: String, required: true },
  hint: { type: String, default: '' },
});
</script>

<template>
  <div class="empty-state">
    <div class="es-icon"><AppIcon :name="icon" :size="22" /></div>
    <b>{{ title }}</b>
    <p v-if="hint">{{ hint }}</p>
    <slot />
  </div>
</template>

<style scoped>
.empty-state { text-align: center; padding: 30px 16px; color: var(--muted); }
.es-icon {
  width: 44px; height: 44px; margin: 0 auto 10px; display: grid; place-items: center;
  border-radius: 12px; background: var(--brand-light); color: var(--brand-dark);
}
.empty-state b { display: block; color: var(--ink); font-size: 13.5px; margin-bottom: 3px; }
.empty-state p { font-size: 12px; margin: 0 0 10px; }
</style>
