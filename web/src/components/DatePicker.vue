<script setup>
// Styled calendar picker replacing native <input type="date"> app-wide.
// Usage: <DatePicker v-model="date" @change="load" /> — v-model is a
// 'YYYY-MM-DD' string ('' = empty). Emits 'change' after every pick/clear.
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import AppIcon from './AppIcon.vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: 'Pick a date' },
});
const emit = defineEmits(['update:modelValue', 'change']);

const open = ref(false);
const root = ref(null);

const pad = (n) => String(n).padStart(2, '0');
const toKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayKey = new Date().toLocaleDateString('sv-SE');
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// which month the calendar shows — follows the value, defaults to today
const cursor = ref({ y: 0, m: 0 });
function resetCursor() {
  const src = isDate(props.modelValue) ? props.modelValue : todayKey;
  cursor.value = { y: +src.slice(0, 4), m: +src.slice(5, 7) - 1 };
}
resetCursor();
watch(() => props.modelValue, resetCursor);

const label = computed(() => {
  if (!isDate(props.modelValue)) return '';
  const [y, m, d] = props.modelValue.split('-').map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
});

const weeks = computed(() => {
  const { y, m } = cursor.value;
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday-first
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let d = 1; d <= days; d += 1) cells.push({ d, key: toKey(y, m, d) });
  while (cells.length % 7) cells.push(null);
  const out = [];
  for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
  return out;
});

function step(delta) {
  const m = cursor.value.m + delta;
  cursor.value = { y: cursor.value.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
}
function pick(key) {
  emit('update:modelValue', key);
  emit('change');
  open.value = false;
}
function clear() {
  emit('update:modelValue', '');
  emit('change');
  open.value = false;
}
function toggle() {
  open.value = !open.value;
  if (open.value) resetCursor();
}

function onDocClick(e) {
  if (root.value && !root.value.contains(e.target)) open.value = false;
}
watch(open, (o) => {
  if (o) document.addEventListener('mousedown', onDocClick);
  else document.removeEventListener('mousedown', onDocClick);
});
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick));
</script>

<template>
  <div ref="root" class="dp">
    <button type="button" class="dp-input" :class="{ empty: !label }" @click="toggle" @keydown.esc="open = false">
      <AppIcon name="calendar" :size="14" />
      <span class="dp-label">{{ label || placeholder }}</span>
      <AppIcon name="chevronDown" :size="12" class="dp-chev" />
    </button>
    <div v-if="open" class="dp-pop">
      <div class="dp-head">
        <button type="button" class="dp-nav" aria-label="Previous month" @click="step(-1)">
          <AppIcon name="chevronRight" :size="13" style="transform: rotate(180deg);" />
        </button>
        <b>{{ MONTHS[cursor.m] }} {{ cursor.y }}</b>
        <button type="button" class="dp-nav" aria-label="Next month" @click="step(1)">
          <AppIcon name="chevronRight" :size="13" />
        </button>
      </div>
      <div class="dp-grid">
        <span v-for="d in DOW" :key="d" class="dp-dow">{{ d }}</span>
        <template v-for="(w, wi) in weeks">
          <button v-for="(c, ci) in w" :key="`${wi}-${ci}`" type="button" class="dp-day"
            :class="{ blank: !c, sel: c && c.key === modelValue, today: c && c.key === todayKey }"
            :disabled="!c" @click="c && pick(c.key)">{{ c?.d || '' }}</button>
        </template>
      </div>
      <div class="dp-foot">
        <button type="button" class="dp-link" @click="pick(todayKey)">Today</button>
        <button v-if="modelValue" type="button" class="dp-link is-muted" @click="clear">Clear</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dp { position: relative; min-width: 0; }
.dp-input {
  display: flex; align-items: center; gap: 8px; width: 100%;
  border: 1px solid #cbd5d3; border-radius: 8px; padding: 8px 10px;
  font: 400 13px var(--font-ui); background: #fff; color: var(--ink); cursor: pointer; text-align: left;
}
.dp-input:focus { outline: 2px solid #9fd4cc; border-color: var(--brand); }
.dp-input.empty .dp-label { color: var(--muted); }
.dp-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dp-chev { color: var(--muted); flex-shrink: 0; }
.dp-pop {
  position: absolute; z-index: 60; top: calc(100% + 5px); left: 0; min-width: 236px;
  background: #fff; border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 12px 32px rgba(10, 28, 26, 0.18); padding: 10px;
}
.dp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.dp-head b { font-size: 12.5px; }
.dp-nav {
  width: 26px; height: 26px; border: 1px solid var(--line); border-radius: 7px;
  background: #fff; color: var(--muted); cursor: pointer; display: grid; place-items: center;
}
.dp-nav:hover { border-color: var(--brand); color: var(--brand); }
.dp-grid { display: grid; grid-template-columns: repeat(7, 30px); gap: 2px; }
.dp-dow { font-size: 9.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; text-align: center; padding: 3px 0; }
.dp-day {
  height: 28px; border: 0; border-radius: 7px; background: none; font: 400 12px var(--font-ui);
  color: var(--ink); cursor: pointer;
}
.dp-day:hover:not(:disabled) { background: var(--brand-light); }
.dp-day.blank { cursor: default; }
.dp-day.today { box-shadow: inset 0 0 0 1px var(--brand); }
.dp-day.sel { background: var(--brand); color: #fff; font-weight: 700; }
.dp-foot { display: flex; justify-content: space-between; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--line); }
.dp-link { border: 0; background: none; color: var(--brand); font: 600 11.5px var(--font-ui); cursor: pointer; padding: 2px 4px; }
.dp-link.is-muted { color: var(--muted); }
</style>
