<script setup>
// Label + control wrapper so every form in the app looks identical.
// Usage: <FormField label="Amount" :error="err"><input v-model="x" type="number" /></FormField>
// `error` renders inline under the control and outlines it in red.
defineProps({
  label: { type: String, required: true },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
});
</script>

<template>
  <div class="ff" :class="{ invalid: error }">
    <label class="field-label">{{ label }}</label>
    <slot />
    <small v-if="error" class="field-error">{{ error }}</small>
    <small v-else-if="hint" class="hint">{{ hint }}</small>
  </div>
</template>

<style scoped>
.ff { min-width: 0; }
.hint { display: block; color: var(--muted); font-size: 10.5px; margin-top: 3px; }
.field-error { display: block; color: var(--red); font-size: 11px; font-weight: 600; margin-top: 3px; }
.ff.invalid :deep(input), .ff.invalid :deep(select) {
  border-color: var(--red);
  outline-color: #f2c4bf;
}
</style>
