<script setup>
// Multi-series line chart, inline SVG, no dependencies (CSP-safe).
// Usage: <TrendChart :labels="['Feb','Mar']" :series="[{ label, color, values }]"
//          :format="(v) => money(v * 100, 'KES')" :extra="(i) => `Profit: …`" />
// values are plain numbers on one shared axis; `extra` adds a computed
// tooltip line (e.g. profit) per point index.
import { computed, ref } from 'vue';

const props = defineProps({
  labels: { type: Array, required: true },
  series: { type: Array, required: true }, // [{ label, color, values: number[] }]
  format: { type: Function, default: (v) => Number(v).toLocaleString() },
  extra: { type: Function, default: null },
});

const W = 520; const H = 210;
const PAD = { t: 12, r: 16, b: 24, l: 48 };

const maxVal = computed(() => Math.max(1, ...props.series.flatMap((s) => s.values)));
// clean 1/2/5×10ⁿ tick steps so the axis reads as round numbers
const step = computed(() => {
  const pow = 10 ** Math.floor(Math.log10(maxVal.value / 3 || 1));
  return [1, 2, 5, 10].map((k) => k * pow).find((s) => s * 3 >= maxVal.value) || pow * 10;
});
const ticks = computed(() => {
  const out = [];
  for (let v = 0; v <= Math.ceil(maxVal.value / step.value) * step.value; v += step.value) out.push(v);
  return out;
});
const top = computed(() => ticks.value[ticks.value.length - 1] || 1);

const x = (i) => PAD.l + (props.labels.length < 2 ? 0.5 : i / (props.labels.length - 1)) * (W - PAD.l - PAD.r);
const y = (v) => H - PAD.b - (v / top.value) * (H - PAD.t - PAD.b);
const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
const shortTick = (v) => (v >= 1000 ? `${(v / 1000).toLocaleString()}k` : String(v));

// hover crosshair + tooltip (nearest point on the x axis)
const hover = ref(null);
const wrap = ref(null);
function onMove(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * W;
  let best = 0; let bd = Infinity;
  for (let i = 0; i < props.labels.length; i += 1) {
    const d = Math.abs(x(i) - px);
    if (d < bd) { bd = d; best = i; }
  }
  hover.value = best;
}
const tipStyle = computed(() => {
  if (hover.value == null) return {};
  const leftPct = (x(hover.value) / W) * 100;
  return leftPct > 55
    ? { right: `${100 - leftPct + 2}%` }
    : { left: `${leftPct + 2}%` };
});
</script>

<template>
  <div class="tc">
    <div class="tc-legend">
      <span v-for="s in series" :key="s.label" class="tc-key">
        <i :style="{ background: s.color }" /> {{ s.label }}
      </span>
    </div>
    <div ref="wrap" class="tc-wrap">
      <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet"
        @mousemove="onMove" @mouseleave="hover = null">
        <g v-for="t in ticks" :key="t">
          <line :x1="PAD.l" :x2="W - PAD.r" :y1="y(t)" :y2="y(t)" class="tc-grid" />
          <text :x="PAD.l - 7" :y="y(t) + 3" class="tc-tick" text-anchor="end">{{ shortTick(t) }}</text>
        </g>
        <text v-for="(l, i) in labels" :key="l" :x="x(i)" :y="H - 7" class="tc-tick" text-anchor="middle">{{ l }}</text>
        <line v-if="hover != null" :x1="x(hover)" :x2="x(hover)" :y1="PAD.t" :y2="H - PAD.b" class="tc-cross" />
        <g v-for="s in series" :key="s.label">
          <path :d="path(s.values)" fill="none" :stroke="s.color" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" />
          <circle v-for="(v, i) in s.values" :key="i" :cx="x(i)" :cy="y(v)"
            :r="hover === i ? 5 : 4" :fill="s.color" stroke="#fff" stroke-width="2" />
        </g>
      </svg>
      <div v-if="hover != null" class="tc-tip" :style="tipStyle">
        <b>{{ labels[hover] }}</b>
        <div v-for="s in series" :key="s.label" class="tc-tip-row">
          <i :style="{ background: s.color }" /> {{ s.label }}: <b>{{ format(s.values[hover]) }}</b>
        </div>
        <div v-if="extra" class="tc-tip-extra">{{ extra(hover) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tc-wrap { position: relative; }
.tc-wrap svg { width: 100%; height: auto; display: block; }
.tc-legend { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 4px; }
.tc-key { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--muted); font-weight: 600; }
.tc-key i, .tc-tip-row i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.tc-grid { stroke: #eef2f1; stroke-width: 1; }
.tc-cross { stroke: #cbd5d3; stroke-width: 1; }
.tc-tick { font: 600 9.5px var(--font-ui); fill: var(--muted); }
.tc-tip {
  position: absolute; top: 8px; background: var(--side); color: #e2e8f0; border-radius: 9px;
  padding: 8px 11px; font-size: 11.5px; pointer-events: none; white-space: nowrap;
  box-shadow: 0 8px 24px rgba(10, 28, 26, 0.25); z-index: 5;
}
.tc-tip-row { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
.tc-tip-extra { margin-top: 4px; color: #7ed7c9; font-weight: 700; }
</style>
