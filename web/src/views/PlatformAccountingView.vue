<script setup>
// Platform accounting: the platform's own billing income — active / closed /
// total invoices and cash collected, for all time, one month, or one day.
import { computed, onMounted, ref } from 'vue';
import DataTable from '../components/DataTable.vue';
import EmptyState from '../components/EmptyState.vue';
import KpiCard from '../components/KpiCard.vue';
import Modal from '../components/Modal.vue';
import Panel from '../components/Panel.vue';
import DatePicker from '../components/DatePicker.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { platformApi } from '../platformApi.js';
import { dateOnly, money, monthLabel, recentMonths } from '../utils/format.js';

const data = ref(null);
const error = ref('');
const scope = ref('all'); // all | month | day
const month = ref(recentMonths(1)[0]);
const day = ref(new Date().toISOString().slice(0, 10));
const months = recentMonths(12);
const offset = ref(0);
const limit = 12;

const columns = [
  { key: 'period', label: 'Period' },
  { key: 'invoicedCents', label: 'Invoiced', align: 'right' },
  { key: 'collectedCents', label: 'Collected', align: 'right' },
  { key: 'activeCount', label: 'Active', align: 'right' },
  { key: 'closedCount', label: 'Closed', align: 'right' },
  { key: 'totalCount', label: 'Invoices', align: 'right' },
  { key: 'actions', label: '', align: 'right' },
];

// drill-down: every invoice involved in a period's income — issued in it, or
// paid (in part or full) during it
const drill = ref(null); // { period, rows, total, offset }
const drillColumns = [
  { key: 'number', label: 'Invoice' },
  { key: 'tenantName', label: 'Tenant' },
  { key: 'status', label: 'Status' },
  { key: 'totalCents', label: 'Total', align: 'right' },
  { key: 'paidCents', label: 'Paid', align: 'right' },
  { key: 'dueAt', label: 'Due' },
];
const drillLimit = 8;
const drillLabel = (p) => (p.length === 7 ? monthLabel(p) : p);

async function openDrill(period, nextOffset = 0) {
  error.value = '';
  try {
    const result = await platformApi.get(`/invoices?period=${period}&limit=${drillLimit}&offset=${nextOffset}`);
    drill.value = { period, rows: result.rows, total: result.total, offset: nextOffset };
  } catch (e) { error.value = e.message; }
}

const scopeLabel = computed(() =>
  scope.value === 'month' ? monthLabel(month.value) : scope.value === 'day' ? day.value : 'all time');

async function load(nextOffset = 0) {
  offset.value = nextOffset;
  error.value = '';
  try {
    const params = new URLSearchParams({ limit, offset: nextOffset });
    if (scope.value === 'month') params.set('month', month.value);
    if (scope.value === 'day') params.set('day', day.value);
    data.value = await platformApi.get(`/accounting?${params}`);
  } catch (e) { error.value = e.message; }
}
onMounted(() => load());
</script>

<template>
  <p v-if="error" class="error-text">{{ error }}</p>
  <template v-else-if="data">
    <div class="kpis">
      <KpiCard label="Income collected" :value="money(data.collectedCents)" icon="finance" icon-tone="green"
        :delta="`${data.paymentsCount} payment${data.paymentsCount === 1 ? '' : 's'} · ${scopeLabel}`" />
      <KpiCard label="Active invoices" :value="money(data.active.outstandingCents)" icon="clock" icon-tone="orange"
        :delta="`${data.active.count} open · ${money(data.active.paidCents)} already paid`" />
      <KpiCard label="Closed invoices" :value="money(data.closed.invoicedCents)" icon="checkCircle" icon-tone="blue"
        :delta="`${data.closed.count} fully paid`" />
      <KpiCard label="Total invoiced" :value="money(data.total.invoicedCents)" icon="orders" icon-tone="violet"
        :delta="`${data.total.count} invoices · ${data.voidCount} void · ${data.draftCount} draft`" />
    </div>

    <Panel title="Income by period" :subtitle="scope === 'all' ? 'Monthly totals across the platform — newest first' : `Daily totals · ${scopeLabel}`">
      <template #actions>
        <select v-model="scope" class="filter" @change="load(0)">
          <option value="all">All time</option>
          <option value="month">Month</option>
          <option value="day">Specific day</option>
        </select>
        <select v-if="scope === 'month'" v-model="month" class="filter" @change="load(0)">
          <option v-for="m in months" :key="m" :value="m">{{ monthLabel(m) }}</option>
        </select>
        <DatePicker v-if="scope === 'day'" v-model="day" class="filter-dp" @change="load(0)" />
      </template>
      <EmptyState v-if="!data.breakdown.rows.length" icon="finance" title="No billing activity"
        :hint="`No invoices were issued and no payments were received in ${scopeLabel}.`" />
      <template v-else>
        <DataTable :columns="columns" :page="{ rows: data.breakdown.rows, total: data.breakdown.total, limit, offset }" @page="load">
          <template #cell-period="{ row }"><b>{{ drillLabel(row.period) }}</b></template>
          <template #cell-invoicedCents="{ row }">{{ money(row.invoicedCents) }}</template>
          <template #cell-collectedCents="{ row }"><b class="collected">{{ money(row.collectedCents) }}</b></template>
          <template #cell-actions="{ row }">
            <button class="btn btn-ghost btn-sm" @click="openDrill(row.period)">View invoices</button>
          </template>
        </DataTable>
      </template>
    </Panel>

    <Modal v-if="drill" :title="`Invoices · ${drillLabel(drill.period)}`" wide @close="drill = null">
      <p class="muted small drill-hint">Every invoice involved in this period's income — issued in it, or paid (in part or full) during it.</p>
      <DataTable :columns="drillColumns" :page="{ rows: drill.rows, total: drill.total, limit: drillLimit, offset: drill.offset }" @page="(o) => openDrill(drill.period, o)">
        <template #cell-number="{ row }">
          <router-link class="invoice-link" :to="{ name: 'platform-invoice', params: { id: row.id } }">{{ row.number }}</router-link>
          <small>{{ dateOnly(row.issuedAt || row.createdAt) }}</small>
        </template>
        <template #cell-status="{ row }"><StatusBadge :status="row.status" kind="generic" /></template>
        <template #cell-totalCents="{ row }">{{ money(row.totalCents, row.currency) }}</template>
        <template #cell-paidCents="{ row }"><b class="collected">{{ money(row.paidCents, row.currency) }}</b></template>
        <template #cell-dueAt="{ row }">{{ dateOnly(row.dueAt) }}</template>
      </DataTable>
    </Modal>
    <p class="muted small note">Income is recognised on completed payments (paid date); invoice counts follow their issue date. Draft and void invoices never count as income.</p>
  </template>
</template>

<style scoped>
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.filter { height: 34px; border: 1px solid var(--line); border-radius: 8px; padding: 0 8px; background: #fff; font: inherit; }
.filter-dp { width: 155px; }
.collected { color: var(--brand-dark); }
.note { margin-top: 10px; }
.drill-hint { margin-bottom: 10px; }
.invoice-link { color: var(--brand-dark); font-weight: 700; text-decoration: none; }
.invoice-link:hover { text-decoration: underline; }
small { display: block; color: var(--muted); font-size: 9px; }
@media (max-width: 980px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 640px) { .kpis { grid-template-columns: 1fr; } }
</style>
