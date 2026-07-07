<script setup>
import AppIcon from './AppIcon.vue';

defineProps({
  label: { type: String, required: true },
  value: { type: String, required: true },
  delta: { type: String, default: '' },
  deltaKind: { type: String, default: 'neutral' }, // up | down | neutral
  icon: { type: String, default: '' },
  iconTone: { type: String, default: 'blue' }, // blue | green | violet | orange
  bars: { type: Array, default: () => [] },
  progress: { type: Number, default: null },
});
</script>

<template>
  <article class="kpi">
    <div v-if="icon" class="kpi-icon" :class="iconTone"><AppIcon :name="icon" :size="18" /></div>
    <div class="kpi-body">
      <span class="kpi-label">{{ label }}</span>
      <strong class="kpi-value">{{ value }}</strong>
      <small v-if="delta" class="kpi-delta" :class="deltaKind">{{ delta }}</small>
    </div>
    <div v-if="bars.length" class="kpi-bars" aria-hidden="true">
      <i v-for="(bar, index) in bars" :key="index" :style="{ height: `${Math.max(18, bar)}%` }" />
    </div>
    <div v-else-if="progress !== null" class="kpi-ring" :style="{ '--progress': Math.min(100, Math.max(0, progress)) }">
      <span>{{ Math.round(progress) }}%</span>
    </div>
  </article>
</template>

<style scoped>
.kpi {
  min-height: 96px; padding: 16px; background: #fff; border: 1px solid var(--line);
  border-radius: 12px; display: flex; align-items: flex-start; gap: 12px;
  box-shadow: var(--shadow-card); position: relative; overflow: hidden;
}
.kpi-icon { flex: 0 0 35px; height: 35px; display: grid; place-items: center; border-radius: 9px; }
.kpi-icon.blue { color: #3678a4; background: #e9f3f8; }
.kpi-icon.green { color: #26826c; background: #e6f5ef; }
.kpi-icon.violet { color: #6957a7; background: #eeeafb; }
.kpi-icon.orange { color: #ba7047; background: #fbede6; }
.kpi-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.kpi-label { color: #7d8a8d; font-size: 10.5px; font-weight: 500; }
.kpi-value { font: 700 20px var(--font-ui); letter-spacing: -0.04em; white-space: nowrap; }
.kpi-delta { color: #879496; font-size: 10px; }
.kpi-delta.up { color: #2a8b70; }
.kpi-delta.down { color: var(--red); }
.kpi-bars { height: 52px; margin-left: auto; align-self: center; display: flex; align-items: flex-end; gap: 3px; }
.kpi-bars i { width: 4px; min-height: 7px; border-radius: 4px 4px 1px 1px; background: #8fd5cb; }
.kpi-bars i:nth-last-child(-n + 2) { background: var(--brand); }
.kpi-ring {
  --progress: 0; flex: 0 0 52px; height: 52px; margin-left: auto; align-self: center;
  display: grid; place-items: center; border-radius: 50%;
  background: conic-gradient(var(--purple) calc(var(--progress) * 1%), #ece9f8 0);
  position: relative;
}
.kpi-ring::after { content: ''; position: absolute; inset: 6px; border-radius: 50%; background: #fff; }
.kpi-ring span { position: relative; z-index: 1; font-size: 9px; font-weight: 800; color: var(--purple); }
@media (max-width: 640px) {
  .kpi { min-height: 108px; padding: 13px; gap: 9px; }
  .kpi-icon { flex-basis: 32px; height: 32px; }
  .kpi-value { font-size: 18px; }
  .kpi-bars { position: absolute; right: 12px; bottom: 12px; height: 34px; opacity: .85; }
  .kpi-ring { flex-basis: 44px; height: 44px; }
}
</style>
