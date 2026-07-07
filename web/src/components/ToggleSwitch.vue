<script setup>
defineProps({
  modelValue: { type: Boolean, required: true },
  disabled: { type: Boolean, default: false },
});
defineEmits(['update:modelValue']);
</script>

<template>
  <label class="switch" :class="{ disabled }">
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="$emit('update:modelValue', $event.target.checked)"
    />
    <span class="slider" />
  </label>
</template>

<style scoped>
.switch { position: relative; display: inline-block; width: 34px; height: 19px; flex-shrink: 0; }
.switch.disabled { opacity: 0.5; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; inset: 0; background: #d7dedd; border-radius: 999px; transition: 0.18s; cursor: pointer; }
.slider::before {
  content: ''; position: absolute; width: 15px; height: 15px; left: 2px; top: 2px;
  background: #fff; border-radius: 50%; transition: 0.18s; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.switch input:checked + .slider { background: var(--brand); }
.switch input:checked + .slider::before { transform: translateX(15px); }
</style>
