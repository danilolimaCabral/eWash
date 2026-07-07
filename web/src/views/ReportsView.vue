<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { money, monthNow, monthLabel, dateTime, recentMonths } from '../utils/format.js';
import KpiCard from '../components/KpiCard.vue';
import Panel from '../components/Panel.vue';
import DataTable from '../components/DataTable.vue';
import Skeleton from '../components/Skeleton.vue';
import Tabs from '../components/Tabs.vue';

const session = useSession();
const toast = useToast();
const month = ref(monthNow());
const date = ref(new Date().toLocaleDateString('sv-SE')); // local YYYY-MM-DD
const summary = ref(null);
const register = ref(null);
const auditLog = ref(null); // null = first load (skeleton)

const tab = ref('revenue');
const tabs = computed(() => [
  { key: 'revenue', label: 'Revenue by category', icon: 'chart' },
  { key: 'register', label: 'Daily register', icon: 'cash' },
  { key: 'audit', label: 'Audit log', icon: 'history', count: auditLog.value?.length ?? undefined },
]);

async function load() {
  try {
    [summary.value, register.value, auditLog.value] = await Promise.all([
      api.get(`/reports/summary?month=${month.value}`),
      api.get(`/reports/daily-register?date=${date.value}`),
      api.get('/audit-log'),
    ]);
  } catch (e) { toast.error(e.message); }
}
onMounted(load);

const months = computed(() => recentMonths(12));

const topCategoryPct = computed(() => {
  if (!summary.value?.byCategory?.length || !summary.value.revenueCents) return null;
  const top = summary.value.byCategory[0];
  const total = summary.value.byCategory.reduce((t, c) => t + c.revenueCents, 0);
  return { name: top.category, pct: Math.round((top.revenueCents / total) * 100) };
});

const catBarWidth = (c) => {
  const max = summary.value.byCategory[0]?.revenueCents || 1;
  return Math.max(4, Math.round((c.revenueCents / max) * 100)) + '%';
};

const regColumns = [
  { key: 'attendant', label: 'Attendant' },
  { key: 'orders', label: 'Orders', align: 'right' },
  { key: 'cash', label: 'Cash', align: 'right' },
  { key: 'mpesa', label: 'M-Pesa', align: 'right' },
  { key: 'total', label: 'Total', align: 'right' },
];
const auditColumns = [
  { key: 'at', label: 'When' },
  { key: 'userName', label: 'Who' },
  { key: 'action', label: 'Action' },
  { key: 'detail', label: 'Detail' },
];

const auditDetail = (row) => {
  const p = row.payload || {};
  const bits = [];
  if (p.code) bits.push(p.code);
  if (p.name) bits.push(p.name);
  if (p.amount_cents) bits.push(money(p.amount_cents, session.currency));
  if (p.from && p.to) bits.push(`${p.from} → ${p.to}`);
  if (p.reason) bits.push(`“${p.reason}”`);
  if (p.role) bits.push(`role: ${p.role}`);
  return bits.join(' · ') || row.entity;
};
</script>

<template>
  <div>
    <div class="section-head">
      <div>
        <h2>Reports</h2>
        <p>Owner/Admin only · revenue mix, daily register &amp; audit trail</p>
      </div>
      <div class="head-actions">
        <select v-model="month" style="width: 160px;" @change="load">
          <option v-for="m in months" :key="m" :value="m">{{ monthLabel(m) }}</option>
        </select>
      </div>
    </div>

    <div v-if="!summary" class="cards"><Skeleton variant="kpi" :count="4" /></div>
    <div v-else class="cards">
      <KpiCard :label="`Revenue · ${monthLabel(summary.month)}`" :value="money(summary.revenueCents, session.currency)"
        icon="finance" icon-tone="green" :delta="`${summary.closedOrders} closed orders`"
        :bars="[30, 46, 42, 61, 76, 94]" />
      <KpiCard v-if="topCategoryPct" :label="`From ${topCategoryPct.name}`" :value="`${topCategoryPct.pct}%`"
        icon="chart" icon-tone="blue" delta="of category revenue" :progress="topCategoryPct.pct" />
      <KpiCard label="Orders adding a rider" :value="`${summary.addonAttachRatePct}%`" icon="tag" icon-tone="violet"
        delta="attach rate this month" :progress="summary.addonAttachRatePct" />
      <KpiCard label="Manual discounts" :value="money(summary.discountsCents, session.currency)" icon="alert" icon-tone="orange"
        :delta="`audit log: ${summary.discountAuditEntries} entries, ${summary.discountAuditStaff} staff`"
        :bars="[18, 36, 24, 58, 42, 66]" />
    </div>

    <Tabs v-model="tab" :tabs="tabs" />

    <Panel v-if="tab === 'revenue'" title="Revenue by category"
      :subtitle="`closed orders · avg turnaround ${summary?.avgTurnaroundHours ?? 0}h`">
      <Skeleton v-if="!summary" variant="list" :count="4" />
      <div v-else-if="summary.byCategory.length" class="catbars">
        <div v-for="c in summary.byCategory" :key="c.category" class="catbar">
          <span class="cb-label">{{ c.category }}</span>
          <div class="cb-track"><div class="cb-fill" :style="{ width: catBarWidth(c) }" /></div>
          <b class="mono">{{ money(c.revenueCents, session.currency) }}</b>
        </div>
      </div>
      <p v-else class="muted small">No closed orders this month yet — revenue appears when orders are delivered/collected.</p>
    </Panel>

    <Panel v-else-if="tab === 'register'" title="Daily register" :subtitle="`reconciles the till · ${date}`">
      <template #actions>
        <input v-model="date" type="date" style="width: 150px;" @change="load" />
      </template>
      <Skeleton v-if="!register" variant="table" :count="3" />
      <DataTable v-else :columns="regColumns" :rows="register.rows" row-key="attendantId"
        empty-text="No payments or orders on this date.">
        <template #cell-cash="{ row }"><span class="mono">{{ money(row.cash, session.currency) }}</span></template>
        <template #cell-mpesa="{ row }"><span class="mono">{{ money(row.mpesa, session.currency) }}</span></template>
        <template #cell-total="{ row }"><b class="mono">{{ money(row.cash + row.mpesa, session.currency) }}</b></template>
      </DataTable>
    </Panel>

    <Panel v-else title="Audit log" subtitle="every price-affecting action — immutable">
      <Skeleton v-if="!auditLog" variant="table" :count="5" />
      <DataTable v-else :columns="auditColumns" :rows="auditLog" empty-text="No audit entries yet.">
        <template #cell-at="{ row }">{{ dateTime(row.at) }}</template>
        <template #cell-action="{ row }"><code class="action">{{ row.action }}</code></template>
        <template #cell-detail="{ row }">{{ auditDetail(row) }}</template>
      </DataTable>
    </Panel>
  </div>
</template>

<style scoped>
.catbars { display: flex; flex-direction: column; gap: 10px; }
.catbar { display: grid; grid-template-columns: 110px 1fr auto; gap: 10px; align-items: center; font-size: 12.5px; }
.cb-track { background: #eef4f2; border-radius: 6px; height: 14px; overflow: hidden; }
.cb-fill { background: var(--brand); height: 100%; border-radius: 6px; }
.action { background: #eef2f7; padding: 1px 7px; border-radius: 4px; font-size: 11px; }
@media (max-width: 640px) {
  .catbar { grid-template-columns: 82px 1fr; }
  .catbar b { grid-column: 2; font-size: 11px; margin-top: -7px; }
}
</style>
