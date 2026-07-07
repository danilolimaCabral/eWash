<script setup>
// Shared tab strip. Usage:
//   <Tabs v-model="tab" :tabs="[{ key: 'a', label: 'One', count: 3, icon: 'chart' }]" />
import AppIcon from './AppIcon.vue';

defineProps({
  tabs: { type: Array, required: true }, // [{ key, label, count?, icon? }]
  modelValue: { type: String, required: true },
});
defineEmits(['update:modelValue']);
</script>

<template>
  <div class="tabs-strip" role="tablist">
    <button
      v-for="t in tabs" :key="t.key" role="tab"
      :aria-selected="modelValue === t.key"
      :class="{ active: modelValue === t.key }"
      @click="$emit('update:modelValue', t.key)"
    >
      <AppIcon v-if="t.icon" :name="t.icon" :size="14" />
      {{ t.label }}
      <span v-if="t.count !== undefined" class="count">{{ t.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.tabs-strip {
  display: flex; gap: 4px; border-bottom: 1px solid var(--line);
  margin-bottom: 16px; overflow-x: auto;
  /* swipeable on narrow screens, but never show a scrollbar */
  scrollbar-width: none;
}
.tabs-strip::-webkit-scrollbar { display: none; }
.tabs-strip button {
  border: none; background: none; padding: 10px 14px; font-size: 12.5px; font-weight: 600;
  color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent;
  font-family: inherit; display: flex; gap: 7px; align-items: center; white-space: nowrap;
}
.tabs-strip button:hover { color: var(--ink); }
.tabs-strip button.active { color: var(--brand-dark); border-bottom-color: var(--brand); }
.tabs-strip .count { background: #eef2f1; border-radius: 8px; padding: 1px 7px; font-size: 10px; }
.tabs-strip button.active .count { background: var(--brand-light); color: var(--brand-dark); }
</style>
