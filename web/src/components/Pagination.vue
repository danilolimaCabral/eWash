<script setup>
// Shared server-side pager. Usage: <Pagination :total :limit :offset @change="load" />
import { computed } from 'vue';

const props = defineProps({
  total: { type: Number, required: true },
  limit: { type: Number, default: 20 },
  offset: { type: Number, default: 0 },
});
defineEmits(['change']);
const page = computed(() => Math.floor(props.offset / props.limit) + 1);
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.limit)));
const visiblePages = computed(() => {
  const start = Math.max(1, Math.min(page.value - 2, pages.value - 4));
  return Array.from({ length: Math.min(5, pages.value) }, (_, index) => start + index);
});
</script>

<template>
  <div v-if="total > limit" class="pager">
    <span>{{ offset + 1 }}–{{ Math.min(offset + limit, total) }} of {{ total }}</span>
    <button class="btn btn-outline btn-sm" :disabled="offset === 0" @click="$emit('change', Math.max(0, offset - limit))">Previous</button>
    <button
      v-for="number in visiblePages" :key="number"
      class="page" :class="{ active: number === page }"
      :aria-label="`Page ${number}`" :aria-current="number === page ? 'page' : undefined"
      @click="$emit('change', (number - 1) * limit)"
    >{{ number }}</button>
    <button class="btn btn-outline btn-sm" :disabled="offset + limit >= total" @click="$emit('change', offset + limit)">Next</button>
  </div>
</template>

<style scoped>
.pager { display: flex; align-items: center; justify-content: flex-end; gap: 6px; padding-top: 12px; flex-wrap: wrap; }
.pager span { margin-right: 4px; color: var(--muted); font-size: 10.5px; }
.page { width: 30px; height: 30px; border: 1px solid var(--line); border-radius: 8px; background: #fff; color: var(--muted); font: 600 11px var(--font-ui); cursor: pointer; }
.page.active { border-color: var(--brand); background: var(--brand); color: #fff; }
@media (max-width: 520px) {
  .pager span { flex-basis: 100%; text-align: right; }
  .page { display: none; }
}
</style>
