<script setup>
import { onMounted, ref } from 'vue';
import DataTable from '../components/DataTable.vue';
import KpiCard from '../components/KpiCard.vue';
import Panel from '../components/Panel.vue';
import StatusBadge from '../components/StatusBadge.vue';
import AppSelect from '../components/AppSelect.vue';
import { platformApi } from '../platformApi.js';
import { money, monthLabel, recentMonths } from '../utils/format.js';

const data = ref(null);
const error = ref('');
const total = ref(0);
const offset = ref(0);
const limit = 10;
const month = ref(''); // '' = all-time
const months = recentMonths(12);

const columns = [
  { key: 'rank', label: '#', align: 'right' },
  { key: 'name', label: 'Tenant' },
  { key: 'plan', label: 'Plan' },
  { key: 'closedOrders', label: 'Orders', align: 'right' },
  { key: 'grossCents', label: 'Revenue', align: 'right' },
  { key: 'collectedCents', label: 'Collected', align: 'right' },
  { key: 'status', label: 'Status' },
];

async function load(nextOffset = 0) {
  offset.value = nextOffset;
  error.value = '';
  try {
    const params = new URLSearchParams({ limit, offset: nextOffset });
    if (month.value) params.set('month', month.value);
    const result = await platformApi.get(`/revenue?${params}`);
    data.value = result;
    total.value = result.total;
  } catch (e) { error.value = e.message; }
}
onMounted(() => load());
</script>

<template>
  <p v-if="error" class="error-text">{{ error }}</p>
  <template v-else-if="data">
    <div class="kpis">
      <KpiCard label="Tenant revenue" :value="money(data.grossCents)" icon="chart" icon-tone="green"
        :delta="month ? monthLabel(month) : 'all time'" />
      <KpiCard label="Collected (cash + M-Pesa)" :value="money(data.collectedCents)" icon="finance" icon-tone="blue"
        :delta="month ? monthLabel(month) : 'all time'" />
      <KpiCard label="Closed orders" :value="String(data.closedOrders)" icon="orders" icon-tone="violet" />
      <KpiCard label="Businesses" :value="String(data.total)" icon="branch" icon-tone="orange" />
    </div>

    <Panel title="Revenue by tenant" subtitle="Operational income each business earns through eWash — ranked highest first">
      <template #actions>
        <AppSelect v-model="month" compact class="filter" @change="load(0)">
          <option value="">All time</option>
          <option v-for="m in months" :key="m" :value="m">{{ monthLabel(m) }}</option>
        </AppSelect>
      </template>
      <DataTable :columns="columns" :page="{ rows: data.rows, total, limit, offset }" empty-text="No tenant revenue recorded for this period yet." @page="load">
        <template #cell-rank="{ row }">{{ offset + data.rows.indexOf(row) + 1 }}</template>
        <template #cell-name="{ row }"><b>{{ row.name }}</b></template>
        <template #cell-grossCents="{ row }"><b>{{ money(row.grossCents) }}</b></template>
        <template #cell-collectedCents="{ row }">{{ money(row.collectedCents) }}</template>
        <template #cell-status="{ row }"><StatusBadge :status="row.status" kind="generic" /></template>
      </DataTable>
    </Panel>
    <p class="muted foot">Revenue is recognised on closed (delivered) orders; collected is completed payments. Amounts shown in KES.</p>
  </template>
  <div v-else class="muted">Loading tenant revenue…</div>
</template>

<style scoped>
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}
.filter{width:auto;min-width:160px}
.foot{font-size:10.5px;margin-top:10px}
@media(max-width:980px){.kpis{grid-template-columns:repeat(2,1fr)}}
@media(max-width:520px){.kpis{grid-template-columns:1fr}}
</style>
