<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { money, monthNow, monthLabel, dateTime, recentMonths } from '../utils/format.js';
import KpiCard from '../components/KpiCard.vue';
import Panel from '../components/Panel.vue';
import DatePicker from '../components/DatePicker.vue';
import DataTable from '../components/DataTable.vue';
import Skeleton from '../components/Skeleton.vue';
import Tabs from '../components/Tabs.vue';

const session = useSession();
const toast = useToast();
const month = ref(monthNow());
const date = ref(new Date().toLocaleDateString('sv-SE')); // local YYYY-MM-DD
const summary = ref(null);
const register = ref(null);
const auditLog = ref(null); // { rows, total, limit, offset } — null = loading
const AUDIT_LIMIT = 10;

const tab = ref('revenue');
const tabs = computed(() => [
  { key: 'revenue', label: 'Revenue by category', icon: 'chart' },
  { key: 'compare', label: 'This month vs last', icon: 'finance' },
  { key: 'register', label: 'Daily register', icon: 'cash' },
  { key: 'audit', label: 'Audit log', icon: 'history', count: auditLog.value?.total ?? undefined },
]);

async function load() {
  try {
    [summary.value, register.value, auditLog.value, compare.value] = await Promise.all([
      api.get(`/reports/summary?month=${month.value}`),
      api.get(`/reports/daily-register?date=${date.value}`),
      api.get(`/audit-log?limit=${AUDIT_LIMIT}&offset=0`),
      // the comparison always pins to the running month — projections only
      // make sense for a month that is still in progress
      api.get(`/finance/pl?month=${monthNow()}`),
    ]);
  } catch (e) { toast.error(e.message); }
}
onMounted(load);

async function loadAudit(nextOffset = 0) {
  try { auditLog.value = await api.get(`/audit-log?limit=${AUDIT_LIMIT}&offset=${nextOffset}`); }
  catch (e) { toast.error(e.message); }
}

// ---- this month vs last + end-of-month projection ----
const compare = ref(null);
const today = new Date();
const dayOfMonth = today.getDate();
const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

// last month scaled to the same day, so "change" compares like with like
const prorate = (v) => Math.round((v || 0) * (dayOfMonth / daysInMonth));
const changePct = (cur, prevFull) => {
  const prev = prorate(prevFull);
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
};
const cmpRows = computed(() => {
  const c = compare.value; if (!c) return [];
  const p = c.previous || {};
  return [
    { label: 'Money earned', cur: c.netCents, prev: p.netCents, isMoney: true },
    { label: 'Money spent', cur: c.expensesCents, prev: p.expensesCents, isMoney: true, downIsGood: true },
    { label: 'Profit', cur: c.profitCents, prev: p.profitCents, isMoney: true },
    { label: 'Finished orders', cur: c.closedOrders, prev: p.closedOrders, isMoney: false },
  ];
});

// straight-line pace to month end, with a better/worse band around sales
const project = (v) => (dayOfMonth ? Math.round((v / dayOfMonth) * daysInMonth) : 0);
const projection = computed(() => {
  const c = compare.value; if (!c) return null;
  const earned = project(c.netCents);
  const spent = project(c.expensesCents);
  return {
    base: { earned, spent, profit: earned - spent },
    good: { earned: Math.round(earned * 1.15), spent: Math.round(spent * 0.95), profit: Math.round(earned * 1.15) - Math.round(spent * 0.95) },
    bad: { earned: Math.round(earned * 0.85), spent: Math.round(spent * 1.05), profit: Math.round(earned * 0.85) - Math.round(spent * 1.05) },
  };
});

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

    <div v-else-if="tab === 'compare'" class="cmp-grid">
      <Panel title="This month vs last month"
        :subtitle="`Day ${dayOfMonth} of ${daysInMonth} · change is measured against the same point last month`">
        <Skeleton v-if="!compare" variant="table" :count="4" />
        <table v-else class="cmp-table">
          <thead>
            <tr>
              <th></th>
              <th>{{ monthLabel(compare.previous.month) }} (full)</th>
              <th>This month so far</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in cmpRows" :key="r.label">
              <td><b>{{ r.label }}</b></td>
              <td class="mono">{{ r.isMoney ? money(r.prev || 0, session.currency) : (r.prev || 0) }}</td>
              <td class="mono">{{ r.isMoney ? money(r.cur || 0, session.currency) : (r.cur || 0) }}</td>
              <td>
                <span v-if="changePct(r.cur, r.prev) === null" class="muted">—</span>
                <b v-else :class="(changePct(r.cur, r.prev) >= 0) !== !!r.downIsGood ? 'text-green' : 'text-red'">
                  {{ changePct(r.cur, r.prev) >= 0 ? '▲' : '▼' }} {{ Math.abs(changePct(r.cur, r.prev)) }}%
                </b>
              </td>
            </tr>
          </tbody>
        </table>
      </Panel>

      <Panel title="Where this month is heading"
        :subtitle="`A rough estimate from this month's pace — ${daysInMonth - dayOfMonth} days to go`">
        <Skeleton v-if="!projection" variant="list" :count="3" />
        <template v-else>
          <div class="proj proj-base">
            <div class="proj-head"><b>On today's pace</b></div>
            <div class="proj-nums">earn {{ money(projection.base.earned, session.currency) }} · spend {{ money(projection.base.spent, session.currency) }}</div>
            <div class="proj-profit" :class="projection.base.profit >= 0 ? 'text-green' : 'text-red'">Profit {{ money(projection.base.profit, session.currency) }}</div>
          </div>
          <div class="proj proj-good">
            <div class="proj-head"><b>If it goes well</b> <small class="muted">sales up 15%, spending trimmed</small></div>
            <div class="proj-nums">earn {{ money(projection.good.earned, session.currency) }} · spend {{ money(projection.good.spent, session.currency) }}</div>
            <div class="proj-profit text-green">Profit {{ money(projection.good.profit, session.currency) }}</div>
          </div>
          <div class="proj proj-bad">
            <div class="proj-head"><b>If it goes south</b> <small class="muted">sales down 15%, spending creeps up</small></div>
            <div class="proj-nums">earn {{ money(projection.bad.earned, session.currency) }} · spend {{ money(projection.bad.spent, session.currency) }}</div>
            <div class="proj-profit" :class="projection.bad.profit >= 0 ? 'text-green' : 'text-red'">Profit {{ money(projection.bad.profit, session.currency) }}</div>
          </div>
          <p class="muted small proj-note">
            Estimates simply stretch this month's daily pace to {{ daysInMonth }} days — they get more reliable as the month goes on.
          </p>
        </template>
      </Panel>
    </div>

    <Panel v-else-if="tab === 'register'" title="Daily register" :subtitle="`reconciles the till · ${date}`">
      <template #actions>
        <DatePicker v-model="date" style="width: 150px;" @change="load" />
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
      <DataTable :columns="auditColumns" :page="auditLog" :skeleton-count="5"
        empty-text="No audit entries yet." @page="loadAudit">
        <template #cell-at="{ row }">{{ dateTime(row.at) }}</template>
        <template #cell-action="{ row }"><code class="action">{{ row.action }}</code></template>
        <template #cell-detail="{ row }">{{ auditDetail(row) }}</template>
      </DataTable>
    </Panel>
  </div>
</template>

<style scoped>
/* month comparison + projection */
.cmp-grid { display: grid; grid-template-columns: 1.15fr 1fr; gap: 16px; align-items: start; }
.cmp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.cmp-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--muted); padding: 7px 6px; border-bottom: 1px solid var(--line); }
.cmp-table td { padding: 9px 6px; border-bottom: 1px solid #f0f4f3; }
.proj { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; }
.proj-base { background: #f8fbfa; }
.proj-good { background: #f0faf5; border-color: #cde9dc; }
.proj-bad { background: #fdf5f0; border-color: #f2ddc9; }
.proj-head { font-size: 12.5px; }
.proj-nums { color: var(--muted); font-size: 11.5px; margin-top: 2px; }
.proj-profit { font-weight: 800; font-size: 14.5px; margin-top: 3px; }
.proj-note { margin-top: 6px; }
@media (max-width: 980px) { .cmp-grid { grid-template-columns: 1fr; } }

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
