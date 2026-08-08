<script setup>
// Shared native select wrapper. Usage: <AppSelect v-model="status"><option value="active">Active</option></AppSelect>
import { computed, useAttrs } from 'vue';
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

const props = defineProps({
  modelValue: { type: [String, Number, Boolean, Object], default: '' },
  compact: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue', 'change']);
const attrs = useAttrs();

const value = computed({
  get: () => props.modelValue,
  set: (next) => emit('update:modelValue', next),
});
const controlAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs;
  return rest;
});

function changed(event) {
  emit('change', event);
}
</script>

<template>
  <span class="app-select" :class="[attrs.class, { compact }]" :style="attrs.style">
    <select v-model="value" v-bind="controlAttrs" @change="changed">
      <slot />
    </select>
    <AppIcon class="select-chevron" name="chevronDown" :size="14" />
  </span>
</template>

<style scoped>
.app-select { position: relative; display: inline-flex; width: 100%; min-width: 0; }
.app-select select {
  width: 100%; min-width: 0; padding-right: 32px; appearance: none; cursor: pointer;
  background: var(--card);
}
.app-select select:disabled { cursor: not-allowed; background: var(--surface-muted); color: var(--muted); }
.select-chevron {
  position: absolute; right: 10px; top: 50%; color: var(--muted);
  transform: translateY(-50%); pointer-events: none;
}
.app-select:focus-within .select-chevron { color: var(--brand); }
.compact select { height: 34px; padding-top: 0; padding-bottom: 0; font-size: 11.5px; }
</style>
