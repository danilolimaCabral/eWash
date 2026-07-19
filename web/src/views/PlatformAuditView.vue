<script setup>
import { onMounted, ref } from 'vue';
import DataTable from '../components/DataTable.vue';
import Panel from '../components/Panel.vue';
import { platformApi } from '../platformApi.js';
import { dateTime } from '../utils/format.js';

const rows = ref([]);
const total = ref(0);
const offset = ref(0);
const limit = 10;
const columns = [
  { key: 'at', label: 'Time' }, { key: 'actorName', label: 'Administrator' },
  { key: 'action', label: 'Action' }, { key: 'tenantName', label: 'Tenant' }, { key: 'reason', label: 'Reason' },
];
async function load(nextOffset = 0) {
  offset.value = nextOffset;
  const result = await platformApi.get(`/audit?limit=${limit}&offset=${nextOffset}`);
  rows.value = result.rows;
  total.value = result.total;
}
onMounted(load);
</script>

<template>
  <Panel title="Platform audit log" subtitle="Immutable record of central administrative actions">
    <DataTable :columns="columns" :page="{ rows, total, limit, offset }" @page="load">
      <template #cell-at="{ row }">{{ dateTime(row.at) }}</template>
      <template #cell-action="{ row }"><b>{{ row.action }}</b><small>{{ row.entity }}</small></template>
      <template #cell-tenantName="{ row }">{{ row.tenantName || 'Platform' }}</template>
      <template #cell-reason="{ row }">{{ row.reason || '—' }}</template>
    </DataTable>
  </Panel>
</template>

<style scoped>small{display:block;color:var(--muted);font-size:9px}</style>
