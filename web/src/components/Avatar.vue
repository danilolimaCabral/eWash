<script setup>
import { computed } from 'vue';
import { initials } from '../utils/format.js';

const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 26 },
});

const COLORS = ['#8a7ab8', '#5fb3a1', '#c99a5f', '#6d9ec0', '#d58c68', '#77a7a0'];
const color = computed(() => {
  let h = 0;
  for (const ch of props.name) h = (h * 31 + ch.charCodeAt(0)) % COLORS.length;
  return COLORS[h];
});
</script>

<template>
  <span
    class="av"
    :style="{ background: color, width: size + 'px', height: size + 'px', fontSize: size * 0.36 + 'px' }"
  >{{ initials(name) }}</span>
</template>

<style scoped>
.av {
  display: inline-grid; place-items: center; border-radius: 50%; color: #fff;
  font-weight: 700; font-style: normal; flex-shrink: 0; overflow: hidden;
  line-height: 1; text-transform: uppercase; letter-spacing: 0.02em;
}
</style>
