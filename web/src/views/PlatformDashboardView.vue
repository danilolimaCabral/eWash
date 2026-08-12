<script setup>
import { onMounted, ref } from 'vue';
import DataTable from '../components/DataTable.vue';
import KpiCard from '../components/KpiCard.vue';
import Panel from '../components/Panel.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { platformApi } from '../platformApi.js';
import { dateOnly, money } from '../utils/format.js';

const data = ref(null);
const error = ref('');
onMounted(async () => {
  try { data.value = await platformApi.get('/dashboard'); } catch (e) { error.value = e.message; }
});
const columns = [
  { key: 'name', label: 'Tenant' }, { key: 'plan', label: 'Plan' },
  { key: 'status', label: 'Status' }, { key: 'createdAt', label: 'Joined' },
];
</script>

<template>
  <p v-if="error" class="error-text">{{ error }}</p>
  <template v-else-if="data">
    <div class="kpis">
      <KpiCard label="Total tenants" :value="String(data.total || 0)" icon="branch" />
      <KpiCard label="Active" :value="String(data.active || 0)" icon="checkCircle" icon-tone="green" />
      <KpiCard label="Suspended" :value="String(data.suspended || 0)" icon="alert" icon-tone="orange" />
      <KpiCard label="Outstanding" :value="money(data.outstandingCents)" icon="finance" icon-tone="violet" />
    </div>
    <Panel title="Recently registered" subtitle="Newest businesses on LavTr">
      <DataTable :columns="columns" :rows="data.recent">
        <template #cell-status="{ row }"><StatusBadge :status="row.status" kind="generic" /></template>
        <template #cell-createdAt="{ row }">{{ dateOnly(row.createdAt) }}</template>
      </DataTable>
    </Panel>
  </template>
  <div v-else class="muted">Loading platform metrics…</div>
</template>

<style scoped>.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}@media(max-width:980px){.kpis{grid-template-columns:repeat(2,1fr)}}@media(max-width:520px){.kpis{grid-template-columns:1fr}}</style>
