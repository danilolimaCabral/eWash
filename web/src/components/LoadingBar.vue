<script setup>
// Global top progress bar — visible whenever any API request is in flight.
import { ref, watch } from 'vue';
import { useLoading } from '../stores/loading.js';

const loading = useLoading();
const visible = ref(false);
const finishing = ref(false);
let hideTimer = null;

watch(() => loading.active, (active) => {
  clearTimeout(hideTimer);
  if (active) {
    finishing.value = false;
    visible.value = true;
  } else if (visible.value) {
    finishing.value = true; // sweep to 100% then fade
    hideTimer = setTimeout(() => { visible.value = false; finishing.value = false; }, 260);
  }
});
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="loadbar" :class="{ finishing }" role="progressbar" aria-label="Loading" />
  </Teleport>
</template>

<style scoped>
.loadbar {
  position: fixed; top: 0; left: 0; right: 0; height: 3px; z-index: 300;
  background: linear-gradient(90deg, #77d2c3, var(--brand), #77d2c3);
  background-size: 200% 100%;
  transform-origin: left;
  animation: sweep 1.1s ease-in-out infinite;
  box-shadow: 0 1px 6px rgba(18, 109, 103, 0.45);
}
.loadbar.finishing { animation: finish 0.25s ease-out forwards; }
@keyframes sweep {
  0% { transform: scaleX(0.08); background-position: 0% 0; }
  50% { transform: scaleX(0.72); }
  100% { transform: scaleX(0.94); background-position: -200% 0; }
}
@keyframes finish {
  to { transform: scaleX(1); opacity: 0; }
}
</style>
