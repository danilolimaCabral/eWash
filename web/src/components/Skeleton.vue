<script setup>
// Shared loading skeletons with shimmer. Variants:
//   kpi    — a KPI card placeholder            (count = cards)
//   table  — header + N shimmering rows        (count = rows)
//   list   — N list-item placeholders          (count = items)
//   kanban — N column placeholders             (count = columns)
//   block  — a plain rectangle                 (height prop)
defineProps({
  variant: { type: String, default: 'block' },
  count: { type: Number, default: 3 },
  height: { type: String, default: '120px' },
});
</script>

<template>
  <template v-if="variant === 'kpi'">
    <div v-for="i in count" :key="i" class="sk kpi-sk">
      <div class="shim icon" />
      <div class="lines"><div class="shim w40" /><div class="shim w70 tall" /><div class="shim w30" /></div>
    </div>
  </template>

  <div v-else-if="variant === 'table'" class="table-sk">
    <div class="shim head" />
    <div v-for="i in count" :key="i" class="row-sk">
      <div class="shim circle" />
      <div class="shim w30" /><div class="shim w20" /><div class="shim w15" /><div class="shim w10" />
    </div>
  </div>

  <template v-else-if="variant === 'list'">
    <div v-for="i in count" :key="i" class="sk list-sk">
      <div class="shim circle" />
      <div class="lines"><div class="shim w60" /><div class="shim w35" /></div>
    </div>
  </template>

  <div v-else-if="variant === 'kanban'" class="kanban-sk">
    <div v-for="i in count" :key="i" class="col-sk">
      <div class="shim w50" />
      <div class="shim card" /><div class="shim card" />
    </div>
  </div>

  <div v-else class="shim" :style="{ height, borderRadius: '10px' }" />
</template>

<style scoped>
.shim {
  background: linear-gradient(90deg, #eef3f2 25%, #f7fbfa 50%, #eef3f2 75%);
  background-size: 200% 100%;
  animation: shimmer 1.3s ease-in-out infinite;
  border-radius: 6px; height: 11px;
}
@keyframes shimmer { to { background-position: -200% 0; } }

.sk { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 14px; display: flex; gap: 12px; align-items: flex-start; }
.kpi-sk { min-height: 96px; }
.icon { width: 35px; height: 35px; border-radius: 9px; flex-shrink: 0; }
.circle { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; }
.lines { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.tall { height: 18px; }
.w10 { width: 10%; } .w15 { width: 15%; } .w20 { width: 20%; } .w30 { width: 30%; }
.w35 { width: 35%; } .w40 { width: 40%; } .w50 { width: 50%; } .w60 { width: 60%; } .w70 { width: 70%; }

.table-sk .head { height: 13px; width: 100%; margin-bottom: 14px; opacity: 0.7; }
.row-sk { display: flex; gap: 14px; align-items: center; padding: 10px 0; border-bottom: 1px solid #f0f4f3; }

.list-sk { margin-bottom: 7px; padding: 10px 12px; border-radius: 9px; align-items: center; }

.kanban-sk { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.col-sk { background: #eef4f2; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 10px; min-height: 200px; }
.col-sk .card { height: 74px; border-radius: 10px; }
@media (max-width: 980px) { .kanban-sk { grid-template-columns: repeat(2, 1fr); } }
</style>
