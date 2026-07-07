<script setup>
// Generic table. columns: [{ key, label, align?, width? }]. Cell content is
// overridable per column via a slot named `cell-<key>` receiving { row }.
defineProps({
  columns: { type: Array, required: true },
  rows: { type: Array, required: true },
  rowKey: { type: String, default: 'id' },
  clickable: { type: Boolean, default: false },
  emptyText: { type: String, default: 'Nothing here yet.' },
});
defineEmits(['row-click']);
</script>

<template>
  <div class="table-wrap">
    <table class="data-table">
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
          v-for="row in rows" :key="row[rowKey]"
          :class="{ clickable }"
          @click="clickable && $emit('row-click', row)"
        >
          <td v-for="col in columns" :key="col.key" :style="{ textAlign: col.align || 'left' }">
            <slot :name="`cell-${col.key}`" :row="row">{{ row[col.key] }}</slot>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length" class="empty">{{ emptyText }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table-wrap { overflow-x: auto; }
.data-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.data-table th {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #8b969a;
  padding: 9px 8px; border-bottom: 1px solid var(--line); font-weight: 700; white-space: nowrap;
}
.data-table td { padding: 11px 8px; border-bottom: 1px solid #f0f4f3; vertical-align: middle; }
.data-table tbody tr:hover { background: #f7faf9; }
.data-table tbody tr.clickable { cursor: pointer; }
.data-table .empty { color: var(--muted); text-align: center; padding: 22px; font-size: 12.5px; }
</style>
