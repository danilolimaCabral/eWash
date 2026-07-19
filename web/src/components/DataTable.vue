<script setup>
// THE table for the whole app. columns: [{ key, label, align?, width? }].
// Cell content is overridable per column via a slot named `cell-<key>`
// receiving { row }. Two data modes — both paginated by default:
//   page  — the standard server shape { rows, total, limit, offset }: renders
//           the shared skeleton while `page` is null, then the rows and the
//           shared pager, and emits 'page' with the next offset.
//   rows  — plain array; the table pages it client-side itself (`paginate`
//           rows per page, default 10; pass :paginate="0" to opt out).
// Usage: <DataTable :columns="cols" :page="page" @page="load" @row-click="open" />
import { computed, ref, watch } from 'vue';
import Skeleton from './Skeleton.vue';
import Pagination from './Pagination.vue';

const props = defineProps({
  columns: { type: Array, required: true },
  rows: { type: Array, default: null },
  page: { type: Object, default: undefined }, // undefined = rows mode; null = loading
  paginate: { type: Number, default: 10 }, // rows-mode page size (0 = show all)
  rowKey: { type: String, default: 'id' },
  clickable: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  skeletonCount: { type: Number, default: 4 },
  emptyText: { type: String, default: 'Nothing here yet.' },
});
defineEmits(['row-click', 'page']);

const loading = computed(() => props.page === null);
// rows mode pages itself; back to page one whenever the data set changes
const localOffset = ref(0);
watch(() => props.rows, () => { localOffset.value = 0; });
const displayRows = computed(() => {
  if (props.page) return props.page.rows || [];
  const all = props.rows || [];
  return props.paginate > 0 ? all.slice(localOffset.value, localOffset.value + props.paginate) : all;
});
</script>

<template>
  <Skeleton v-if="loading" variant="table" :count="skeletonCount" />
  <template v-else>
    <div class="table-wrap">
      <table class="data-table" :class="{ compact }">
        <thead>
          <tr>
            <th
              v-for="col in columns" :key="col.key"
              :style="{ textAlign: col.align || 'left', width: col.width || 'auto' }"
            >{{ col.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in displayRows" :key="row[rowKey]"
            :class="{ clickable }"
            @click="clickable && $emit('row-click', row)"
          >
            <td v-for="col in columns" :key="col.key" :style="{ textAlign: col.align || 'left' }">
              <slot :name="`cell-${col.key}`" :row="row">{{ row[col.key] }}</slot>
            </td>
          </tr>
          <tr v-if="!displayRows.length">
            <td :colspan="columns.length" class="empty">{{ emptyText }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <Pagination v-if="page" :total="page.total" :limit="page.limit" :offset="page.offset"
      @change="$emit('page', $event)" />
    <Pagination v-else-if="paginate > 0" :total="(rows || []).length" :limit="paginate"
      :offset="localOffset" @change="(o) => { localOffset = o; }" />
  </template>
</template>

<style scoped>
.table-wrap { overflow-x: auto; }
.data-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.data-table th {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #8b969a;
  padding: 9px 8px; border-bottom: 1px solid var(--line); font-weight: 700; white-space: nowrap;
}
.data-table td { padding: 11px 8px; border-bottom: 1px solid #f0f4f3; vertical-align: middle; }
.data-table.compact { font-size: 12px; }
.data-table.compact td { padding: 6px 8px; }
.data-table tbody tr:hover { background: #f7faf9; }
.data-table tbody tr.clickable { cursor: pointer; }
.data-table .empty { color: var(--muted); text-align: center; padding: 22px; font-size: 12.5px; }
</style>
