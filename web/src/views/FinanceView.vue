<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { money, monthNow, monthLabel, dateOnly, dateTime, recentMonths } from '../utils/format.js';
import { PROVIDER_TYPES } from '../utils/providerTypes.js';
import KpiCard from '../components/KpiCard.vue';
import AppIcon from '../components/AppIcon.vue';
import DatePicker from '../components/DatePicker.vue';
import TrendChart from '../components/TrendChart.vue';
import Panel from '../components/Panel.vue';
import DataTable from '../components/DataTable.vue';
import FormField from '../components/FormField.vue';
import StatusBadge from '../components/StatusBadge.vue';
import Skeleton from '../components/Skeleton.vue';
import Modal from '../components/Modal.vue';
import EmptyState from '../components/EmptyState.vue';
import OrderDetailModal from '../components/OrderDetailModal.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';


const session = useSession();
const toast = useToast();
const month = ref(monthNow());
const pl = ref(null);
const trend = ref(null); // last-6-months financial health (loaded once)
const exPage = ref(null); // { rows, total, limit, offset } — null = loading
const categories = ref([]);
const busy = ref(false);
const activeTab = ref('overview');
const providers = ref([]);
const creditPage = ref(null);
const editingExpenseId = ref(null);
const exModal = ref(false);
// expense list filter: the selected month (default) or a specific date range
const exFilter = ref({ mode: 'month', from: '', to: '' });
const blankExpense = () => ({ category_id: categories.value[0]?.id || '', provider_id: '', amount: 2500, paid_via: 'mpesa', expense_date: new Date().toLocaleDateString('sv-SE'), note: '', recurring: false });
const exForm = ref({ category_id: '', provider_id: '', amount: 2500, paid_via: 'mpesa', expense_date: new Date().toLocaleDateString('sv-SE'), note: '', recurring: false });

// standard table pagination — DataTable renders the pager from these pages
const PAGE_LIMIT = 10;
const provPage = ref(null);

const expenseQuery = () => {
  const f = exFilter.value;
  return f.mode === 'range' && f.from && f.to ? `from=${f.from}&to=${f.to}` : `month=${month.value}`;
};
async function loadExpenses(nextOffset = 0) {
  try {
    exPage.value = await api.get(`/expenses?${expenseQuery()}&limit=${PAGE_LIMIT}&offset=${nextOffset}`);
  } catch (e) { toast.error(e.message); }
}
async function loadCredit(nextOffset = 0) {
  try {
    creditPage.value = await api.get(`/credit-ledger?limit=${PAGE_LIMIT}&offset=${nextOffset}`);
  } catch (e) { toast.error(e.message); }
}
async function loadProviders(nextOffset = 0) {
  try {
    provPage.value = await api.get(`/service-providers?limit=${PAGE_LIMIT}&offset=${nextOffset}`);
  } catch (e) { toast.error(e.message); }
}
const providerForm = ref({ id: '', name: '', service_type: '', phone: '', email: '', notes: '', active: true });
// keep a legacy free-text type selectable when editing an older provider
const providerTypeOptions = computed(() =>
  providerForm.value.service_type && !PROVIDER_TYPES.includes(providerForm.value.service_type)
    ? [providerForm.value.service_type, ...PROVIDER_TYPES]
    : PROVIDER_TYPES);
const providerModal = ref(false);
const openOrderId = ref(null);

// record a payment against an owing order (credit tab) — reuses the same
// policy-guarded endpoint the order view uses
const payModal = ref(false);
const payForm = ref({ order_id: '', amount: 0, method: 'cash', mpesa_ref: '' });
const owing = computed(() => (creditPage.value?.rows || []).filter((r) => r.totalCents > r.paidCents));
function openRecordPayment() {
  const first = owing.value[0];
  payForm.value = { order_id: first?.orderId || '', amount: first ? (first.totalCents - first.paidCents) / 100 : 0, method: 'cash', mpesa_ref: '' };
  payModal.value = true;
}
function payOrderChanged() {
  const row = owing.value.find((r) => r.orderId === payForm.value.order_id);
  if (row) payForm.value.amount = (row.totalCents - row.paidCents) / 100;
}
async function savePayment() {
  if (!payForm.value.order_id) { toast.error('Choose an order'); return; }
  if (!(payForm.value.amount > 0)) { toast.error('Enter an amount'); return; }
  busy.value = true;
  try {
    await api.post(`/orders/${payForm.value.order_id}/payments`, {
      method: payForm.value.method,
      amount_cents: Math.round(payForm.value.amount * 100),
      mpesa_ref: payForm.value.mpesa_ref || undefined,
    });
    toast.success('Payment recorded ✔ — the customer gets a receipt message');
    payModal.value = false;
    await load();
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}

async function load() {
  try {
    const [plData, exData, catData, providerData, creditData, provPageData] = await Promise.all([
      api.get(`/finance/pl?month=${month.value}`),
      api.get(`/expenses?${expenseQuery()}&limit=${PAGE_LIMIT}&offset=0`),
      api.get('/expense-categories'),
      api.get('/service-providers'), // full list — feeds the expense-form dropdown
      api.get(`/credit-ledger?limit=${PAGE_LIMIT}&offset=0`),
      api.get(`/service-providers?limit=${PAGE_LIMIT}&offset=0`),
    ]);
    pl.value = plData;
    exPage.value = exData;
    categories.value = catData;
    providers.value = providerData;
    creditPage.value = creditData;
    provPage.value = provPageData;
    if (!exForm.value.category_id) exForm.value.category_id = catData[0]?.id || '';
    if (plData.autoPostedRecurring) toast.show(`${plData.autoPostedRecurring} monthly expense(s) were added automatically for this month — review below`);
  } catch (e) { toast.error(e.message); }
  // the health chart always shows the last 6 months, whatever month is selected
  try { trend.value = (await api.get('/finance/trend?months=6')).months; }
  catch (e) { toast.error(e.message); }
}
onMounted(load);

// chart inputs — values in whole shillings so the axis reads 1k / 2k
const trendLabels = computed(() =>
  (trend.value || []).map((p) => new Date(`${p.month}-01T00:00:00Z`).toLocaleString('en', { month: 'short', timeZone: 'UTC' })));
const trendSeries = computed(() => [
  { label: 'Money earned', color: '#0d9488', values: (trend.value || []).map((p) => Math.round(p.earnedCents / 100)) },
  { label: 'Money spent', color: '#d97706', values: (trend.value || []).map((p) => Math.round(p.spentCents / 100)) },
]);
const trendHasData = computed(() => (trend.value || []).some((p) => p.earnedCents || p.spentCents));
const profitLine = (i) => {
  const p = trend.value?.[i];
  return p ? `Profit: ${money(p.profitCents, session.currency)}` : '';
};
// expense categories for the selected month, largest first
const topCategories = computed(() => {
  const cats = [...(pl.value?.expensesByCategory || [])].sort((a, b) => b.amountCents - a.amountCents);
  return cats.slice(0, 6);
});
const maxCat = computed(() => Math.max(1, ...topCategories.value.map((e) => e.amountCents)));

// System billing: our own eWash subscription invoices (read-only, loaded
// lazily when the tab is first opened)
const billing = ref(null); // { rows, total, limit, offset }
const billingStatus = ref('');
const BILLING_LIMIT = 10;
const billingDetail = ref(null); // { invoice, items, payments }
const invBalance = (inv) => (inv.status === 'void' ? 0 : inv.totalCents - inv.paidCents);

async function loadBilling(nextOffset = 0) {
  try {
    const params = new URLSearchParams({ limit: BILLING_LIMIT, offset: nextOffset });
    if (billingStatus.value) params.set('status', billingStatus.value);
    billing.value = await api.get(`/billing/invoices?${params}`);
  } catch (e) { toast.error(e.message); }
}
async function openInvoice(row) {
  try { billingDetail.value = await api.get(`/billing/invoices/${row.id}`); }
  catch (e) { toast.error(e.message); }
}
watch(activeTab, () => { if (activeTab.value === 'billing' && !billing.value) loadBilling(0); });

const billingColumns = [
  { key: 'number', label: 'Invoice' },
  { key: 'period', label: 'Billing period' },
  { key: 'status', label: 'Status' },
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'paid', label: 'Paid', align: 'right' },
  { key: 'balance', label: 'Still to pay', align: 'right' },
  { key: 'dueAt', label: 'Pay by' },
];

const months = computed(() => recentMonths(12));

const momDelta = computed(() => {
  if (!pl.value?.previous) return '';
  const prev = pl.value.previous.netCents;
  if (!prev) return 'no data for last month';
  const pct = Math.round(((pl.value.netCents - prev) / prev) * 100);
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs ${monthLabel(pl.value.previous.month)}`;
});

async function saveExpense() {
  if (!(exForm.value.amount > 0)) { toast.error('Enter an amount'); return; }
  busy.value = true;
  try {
    const payload = {
      category_id: exForm.value.category_id,
      provider_id: exForm.value.provider_id || undefined,
      amount_cents: Math.round(exForm.value.amount * 100),
      paid_via: exForm.value.paid_via,
      expense_date: exForm.value.expense_date,
      note: exForm.value.note,
      recurring: exForm.value.recurring,
    };
    if (editingExpenseId.value) await api.put(`/expenses/${editingExpenseId.value}`, payload);
    else await api.post('/expenses', payload);
    toast.success(editingExpenseId.value ? 'Expense updated — change recorded in the audit log' : 'Expense saved ✔ — your books are updated' + (exForm.value.recurring ? ' · will be added automatically every month' : ''));
    editingExpenseId.value = null;
    exModal.value = false;
    exForm.value = blankExpense();
    await load();
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}

function openAddExpense() {
  editingExpenseId.value = null;
  exForm.value = blankExpense();
  exModal.value = true;
}
function closeExpenseModal() {
  exModal.value = false;
  editingExpenseId.value = null;
}
function editExpense(row) {
  editingExpenseId.value = row.id;
  exForm.value = {
    category_id: row.categoryId, provider_id: row.providerId || '', amount: row.amountCents / 100,
    paid_via: row.paidVia, expense_date: row.expenseDate.slice(0, 10), note: row.note || '', recurring: !!row.recurring,
  };
  activeTab.value = 'expenses';
  exModal.value = true;
}

const voidingExpense = ref(null);
async function voidExpense() {
  const row = voidingExpense.value;
  if (!row) return;
  busy.value = true;
  try {
    await api.post(`/expenses/${row.id}/void`);
    toast.success('Expense voided and audit-logged');
    voidingExpense.value = null;
    await load();
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}

async function saveProvider() {
  busy.value = true;
  try {
    const payload = { ...providerForm.value };
    if (payload.id) await api.put(`/service-providers/${payload.id}`, payload);
    else await api.post('/service-providers', payload);
    providerForm.value = { id: '', name: '', service_type: '', phone: '', email: '', notes: '', active: true };
    providerModal.value = false;
    toast.success('Service provider saved');
    await load();
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}

function openAddProvider() {
  providerForm.value = { id: '', name: '', service_type: '', phone: '', email: '', notes: '', active: true };
  providerModal.value = true;
}
function editProvider(row) {
  providerForm.value = { id: row.id, name: row.name, service_type: row.serviceType, phone: row.phone || '', email: row.email || '', notes: row.notes || '', active: !!row.active };
  providerModal.value = true;
}

async function exportCsv() {
  if (!pl.value) return;
  // the on-screen table is one page — export every expense in the period
  let allExpenses;
  try { allExpenses = await api.get(`/expenses?${expenseQuery()}`); }
  catch (e) { toast.error(e.message); return; }
  const rows = [
    ['eWash P&L', monthLabel(month.value)],
    ['Gross revenue (closed orders)', pl.value.grossCents / 100],
    ['less Discounts', -pl.value.discountsCents / 100],
    ['less Refunds & re-wash', -pl.value.refundsCents / 100],
    ['Net revenue', pl.value.netCents / 100],
    ...pl.value.expensesByCategory.map((e) => [`less ${e.category}`, -e.amountCents / 100]),
    ['Operating profit', pl.value.profitCents / 100],
    [],
    ['Expenses detail'],
    ['Date', 'Category', 'Amount', 'Paid via', 'Note'],
    ...allExpenses.map((e) => [e.expenseDate, e.categoryName, e.amountCents / 100, e.paidVia, e.note || '']),
  ];
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `eWash-pl-${month.value}.csv`;
  a.click();
  toast.success('CSV exported for your accountant');
}

const exColumns = [
  { key: 'expenseDate', label: 'Date' },
  { key: 'categoryName', label: 'Category' },
  { key: 'amount', label: 'Amount', align: 'right' },
  { key: 'paidVia', label: 'Via' },
  { key: 'actions', label: '', align: 'right' },
];
const creditColumns = [
  { key: 'code', label: 'Order' }, { key: 'customerName', label: 'Customer' },
  { key: 'balance', label: 'Amount owed', align: 'right' }, { key: 'creditDueAt', label: 'Pay by' },
];
const provColumns = [
  { key: 'name', label: 'Provider' },
  { key: 'serviceType', label: 'What they supply' },
  { key: 'contact', label: 'Contact' },
  { key: 'createdAt', label: 'Added' },
  { key: 'active', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];
</script>

<template>
  <div>
    <div class="section-head">
      <div>
        <h2>Finance — Your books</h2>
        <p>Owner only · Money is counted once an order is <b>finished</b> (delivered or collected)</p>
      </div>
      <div class="head-actions">
        <select v-model="month" style="width: 170px;" @change="load">
          <option v-for="m in months" :key="m" :value="m">{{ monthLabel(m) }}</option>
        </select>
        <button class="btn btn-ghost" @click="exportCsv">Export CSV</button>
      </div>
    </div>

    <div class="finance-tabs">
      <button v-for="tab in [{ key: 'overview', label: 'Overview' }, { key: 'expenses', label: 'Money spent' }, { key: 'credit', label: 'Customers who owe you' }, { key: 'providers', label: 'Service providers' }, { key: 'billing', label: 'Your eWash bill' }]"
        :key="tab.key" :class="{ active: activeTab === tab.key }" @click="activeTab = tab.key">{{ tab.label }}</button>
    </div>

    <div v-if="activeTab === 'overview' && !pl" class="cards"><Skeleton variant="kpi" :count="4" /></div>
    <div v-else-if="activeTab === 'overview'" class="cards">
      <KpiCard label="Money earned · finished orders" :value="money(pl.netCents, session.currency)" icon="finance" icon-tone="green"
        :delta="momDelta" :delta-kind="pl.netCents >= (pl.previous?.netCents || 0) ? 'up' : 'down'" />
      <KpiCard label="Money spent" :value="money(pl.expensesCents, session.currency)" icon="cash" icon-tone="orange"
        :delta="`${exPage?.total ?? 0} entries`" />
      <KpiCard label="Profit" :value="money(pl.profitCents, session.currency)" icon="chart" icon-tone="violet"
        :delta="`you keep ${pl.marginPct}% of sales`" :delta-kind="pl.profitCents >= 0 ? 'up' : 'down'" />
      <KpiCard label="Cash collected" :value="money(pl.collectedCents, session.currency)" icon="clock" icon-tone="blue"
        :delta="pl.receivablesCents > 0 ? `${money(pl.receivablesCents, session.currency)} still owed by customers` : 'everything collected'"
        :delta-kind="pl.receivablesCents > 0 ? 'down' : 'up'" />
    </div>

    <div class="fin-cols">
      <Panel v-if="activeTab === 'overview'" :title="`Money in, money out — ${monthLabel(month)}`"
        :subtitle="`${pl?.closedOrders ?? 0} finished orders${pl?.rewashCount ? ` · ${pl.rewashCount} re-wash redo` : ''}`">
        <Skeleton v-if="!pl" variant="table" :count="6" />
        <table v-else class="pl-table">
          <tbody>
            <tr><td><b>Total sales</b> <span class="muted small">(finished orders — counted automatically)</span></td><td class="text-right mono">{{ money(pl.grossCents, session.currency) }}</td></tr>
            <tr><td class="indent">minus Discounts given</td><td class="text-right mono text-red">({{ money(pl.discountsCents, session.currency) }})</td></tr>
            <tr><td class="indent">minus Refunds &amp; re-washes</td><td class="text-right mono text-red">({{ money(pl.refundsCents, session.currency) }})</td></tr>
            <tr class="rule"><td><b>Money earned</b> <span class="muted small">(after discounts &amp; refunds)</span></td><td class="text-right mono"><b>{{ money(pl.netCents, session.currency) }}</b></td></tr>
            <tr v-for="e in pl.expensesByCategory" :key="e.category">
              <td class="indent">minus {{ e.category }}</td>
              <td class="text-right mono text-red">({{ money(e.amountCents, session.currency) }})</td>
            </tr>
            <tr class="rule strong">
              <td><b>Profit</b> <span class="muted small">(what's left after expenses)</span></td>
              <td class="text-right mono"><b :class="pl.profitCents >= 0 ? 'text-green' : 'text-red'">{{ money(pl.profitCents, session.currency) }}</b></td>
            </tr>
          </tbody>
        </table>
      </Panel>

      <Panel v-if="activeTab === 'overview'" title="Financial health"
        subtitle="Money earned vs money spent — last 6 months">
        <Skeleton v-if="!trend" variant="table" :count="4" />
        <template v-else>
          <template v-if="trendHasData">
            <TrendChart :labels="trendLabels" :series="trendSeries"
              :format="(v) => money(v * 100, session.currency)" :extra="profitLine" />
            <details class="chart-table">
              <summary>View as numbers</summary>
              <table class="mini-table">
                <thead><tr><th>Month</th><th>Earned</th><th>Spent</th><th>Profit</th></tr></thead>
                <tbody>
                  <tr v-for="p in trend" :key="p.month">
                    <td>{{ monthLabel(p.month) }}</td>
                    <td class="mono">{{ money(p.earnedCents, session.currency) }}</td>
                    <td class="mono">{{ money(p.spentCents, session.currency) }}</td>
                    <td class="mono" :class="p.profitCents >= 0 ? 'text-green' : 'text-red'">{{ money(p.profitCents, session.currency) }}</td>
                  </tr>
                </tbody>
              </table>
            </details>
          </template>
          <EmptyState v-else icon="chart" title="No history yet"
            hint="Finish a few orders and record expenses — the trend builds up month by month." />

          <template v-if="topCategories.length">
            <div class="cat-head">Where the money went — {{ monthLabel(month) }}</div>
            <div v-for="e in topCategories" :key="e.category" class="cat-row">
              <span class="cat-name">{{ e.category }}</span>
              <div class="cat-track"><div class="cat-bar" :style="{ width: `${Math.max(4, Math.round((e.amountCents / maxCat) * 100))}%` }" /></div>
              <b class="mono cat-amt">{{ money(e.amountCents, session.currency) }}</b>
            </div>
          </template>
        </template>
      </Panel>
    </div>

    <Panel v-if="activeTab === 'expenses'"
      :title="exFilter.mode === 'range' ? 'Money spent — chosen dates' : `Money spent — ${monthLabel(month)}`"
      subtitle="Everything the business paid for in this period">
      <template #actions>
        <div class="ex-filter">
          <select v-model="exFilter.mode" @change="loadExpenses(0)">
            <option value="month">By month</option>
            <option value="range">Pick dates</option>
          </select>
          <template v-if="exFilter.mode === 'range'">
            <DatePicker v-model="exFilter.from" placeholder="From" class="dp-filter" @change="loadExpenses(0)" />
            <span class="muted small">to</span>
            <DatePicker v-model="exFilter.to" placeholder="To" class="dp-filter" @change="loadExpenses(0)" />
          </template>
          <button v-if="session.can('expenses.create')" class="btn btn-primary btn-sm" @click="openAddExpense">
            <AppIcon name="plus" :size="12" /> Add expense
          </button>
        </div>
      </template>
      <DataTable :columns="exColumns" :page="exPage" empty-text="No money spent in this period." @page="loadExpenses">
        <template #cell-expenseDate="{ row }">{{ dateOnly(row.expenseDate) }}</template>
        <template #cell-categoryName="{ row }">
          {{ row.categoryName }}
          <StatusBadge v-if="row.recurring" status="generic" kind="generic" label="monthly" />
          <StatusBadge v-else-if="row.recurringSourceId" status="queued" kind="generic" label="auto-posted" />
          <small v-if="row.note" class="muted block">{{ row.note }}</small>
          <small v-if="row.providerName" class="muted block">Provider: {{ row.providerName }}</small>
        </template>
        <template #cell-amount="{ row }"><b class="mono">{{ money(row.amountCents, session.currency) }}</b></template>
        <template #cell-paidVia="{ row }">{{ row.paidVia === 'mpesa' ? 'M-Pesa' : 'Cash' }}</template>
        <template #cell-actions="{ row }">
          <span v-if="row.status === 'void'" class="text-red small">Voided</span>
          <template v-else-if="session.can('finance.manage')">
            <button class="btn btn-ghost btn-sm" @click="editExpense(row)">Edit</button>
            <button class="btn btn-danger btn-sm" @click="voidingExpense = row">Void</button>
          </template>
        </template>
      </DataTable>
    </Panel>

    <Modal v-if="exModal" :title="editingExpenseId ? 'Edit expense' : 'Add expense'" @close="closeExpenseModal">
      <div class="row">
        <FormField label="Category">
          <select v-model="exForm.category_id">
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </FormField>
        <FormField :label="`Amount (${session.currency})`">
          <input v-model.number="exForm.amount" type="number" min="1" />
        </FormField>
      </div>
      <div class="row">
        <FormField label="Date"><DatePicker v-model="exForm.expense_date" /></FormField>
        <FormField label="Paid via">
          <select v-model="exForm.paid_via">
            <option value="mpesa">M-Pesa</option>
            <option value="cash">Cash</option>
          </select>
        </FormField>
      </div>
      <div class="row">
        <FormField label="Service provider (optional)">
          <select v-model="exForm.provider_id"><option value="">None</option><option v-for="p in providers.filter((x) => x.active)" :key="p.id" :value="p.id">{{ p.name }}</option></select>
        </FormField>
        <FormField label="Note"><input v-model="exForm.note" type="text" placeholder="e.g. 20L detergent, Sarit" /></FormField>
      </div>
      <label class="rec-check">
        <input v-model="exForm.recurring" type="checkbox" /> Repeats every month (added automatically, with a reminder)
      </label>
      <template #footer>
        <button class="btn btn-ghost" @click="closeExpenseModal">Cancel</button>
        <button class="btn btn-primary" :disabled="busy" @click="saveExpense">{{ editingExpenseId ? 'Update expense' : 'Save expense' }}</button>
      </template>
    </Modal>

    <Panel v-if="activeTab === 'credit'" title="Customers who still owe you" subtitle="Tap a row to open the order, or record a payment directly">
      <template #actions>
        <button v-if="session.can('payments.receive')" class="btn btn-primary btn-sm" @click="openRecordPayment">
          <AppIcon name="plus" :size="12" /> Record payment
        </button>
      </template>
      <DataTable :columns="creditColumns" :page="creditPage" clickable
        empty-text="No customer owes you money right now." @page="loadCredit" @row-click="(row) => openOrderId = row.orderId">
        <template #cell-code="{ row }"><b>{{ row.code }}</b></template>
        <template #cell-customerName="{ row }">{{ row.customerName }}<small class="muted block">{{ row.customerPhone }}</small></template>
        <template #cell-balance="{ row }"><b class="text-red mono">{{ money(row.totalCents - row.paidCents, session.currency) }}</b></template>
        <template #cell-creditDueAt="{ row }"><span :class="{ 'text-red': row.creditDueAt && row.creditDueAt < new Date().toISOString() }">{{ dateOnly(row.creditDueAt) }}</span></template>
      </DataTable>
    </Panel>

    <Panel v-if="activeTab === 'providers'" title="Service providers"
      subtitle="People and companies you pay — link them when recording money spent">
      <template #actions>
        <button class="btn btn-primary btn-sm" @click="openAddProvider">
          <AppIcon name="plus" :size="12" /> Add provider
        </button>
      </template>
      <DataTable :columns="provColumns" :page="provPage" clickable :skeleton-count="3"
        empty-text="No providers yet — add the people and companies you pay (delivery riders, water, detergents)."
        @page="loadProviders" @row-click="editProvider">
          <template #cell-name="{ row }"><b>{{ row.name }}</b><small v-if="row.notes" class="muted block">{{ row.notes }}</small></template>
          <template #cell-contact="{ row }">
            {{ row.phone || row.email || '—' }}
            <small v-if="row.phone && row.email" class="muted block">{{ row.email }}</small>
          </template>
          <template #cell-createdAt="{ row }">{{ dateOnly(row.createdAt) }}</template>
          <template #cell-active="{ row }"><span :class="row.active ? 'text-green' : 'muted'">{{ row.active ? 'Active' : 'Inactive' }}</span></template>
          <template #cell-actions><button class="btn btn-ghost btn-sm">Edit</button></template>
      </DataTable>
    </Panel>

    <Modal v-if="providerModal" :title="providerForm.id ? 'Edit provider' : 'Add service provider'" @close="providerModal = false">
      <div class="row"><FormField label="Name"><input v-model="providerForm.name" type="text" /></FormField><FormField label="What they supply">
          <select v-model="providerForm.service_type">
            <option disabled value="">Choose a service type…</option>
            <option v-for="t in providerTypeOptions" :key="t" :value="t">{{ t }}</option>
          </select>
        </FormField></div>
      <div class="row"><FormField label="Phone"><input v-model="providerForm.phone" type="tel" /></FormField><FormField label="Email"><input v-model="providerForm.email" type="email" /></FormField></div>
      <FormField label="Notes"><input v-model="providerForm.notes" type="text" /></FormField>
      <template #footer>
        <button class="btn btn-ghost" @click="providerModal = false">Cancel</button>
        <button class="btn btn-primary" :disabled="busy" @click="saveProvider">Save provider</button>
      </template>
    </Modal>

    <Modal v-if="payModal" title="Record a payment" @close="payModal = false">
      <FormField label="Order" hint="Who is paying, and for which order">
        <select v-model="payForm.order_id" @change="payOrderChanged">
          <option v-for="r in owing" :key="r.orderId" :value="r.orderId">
            {{ r.code }} · {{ r.customerName }} — owes {{ money(r.totalCents - r.paidCents, session.currency) }}
          </option>
        </select>
      </FormField>
      <div class="row">
        <FormField :label="`Amount (${session.currency})`"><input v-model.number="payForm.amount" type="number" min="1" /></FormField>
        <FormField label="Paid via">
          <select v-model="payForm.method">
            <option value="cash">Cash</option>
            <option value="mpesa_manual">M-Pesa (enter code)</option>
          </select>
        </FormField>
      </div>
      <FormField v-if="payForm.method === 'mpesa_manual'" label="M-Pesa transaction code">
        <input v-model="payForm.mpesa_ref" type="text" placeholder="e.g. QGH7KLM2P1" />
      </FormField>
      <template #footer>
        <button class="btn btn-ghost" @click="payModal = false">Cancel</button>
        <button class="btn btn-primary" :disabled="busy" @click="savePayment">Record payment</button>
      </template>
    </Modal>

    <Panel v-if="activeTab === 'billing'" title="Your eWash bill"
      subtitle="Invoices for your eWash subscription — what you've been billed, what you've paid, and what's still to pay. Paid invoices are added to your expenses automatically.">
      <template #actions>
        <select v-model="billingStatus" @change="loadBilling(0)">
          <option value="">All invoices</option>
          <option value="issued">Issued</option>
          <option value="partially_paid">Partially paid</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
          <option value="void">Void</option>
        </select>
      </template>
      <template v-if="!billing || billing.rows.length">
        <DataTable :columns="billingColumns" :page="billing" clickable @page="loadBilling" @row-click="openInvoice">
            <template #cell-number="{ row }">
              <b class="inv">{{ row.number }}</b>
              <small class="muted block">issued {{ dateOnly(row.issuedAt || row.createdAt) }}</small>
            </template>
            <template #cell-period="{ row }">
              <template v-if="row.periodStart">{{ dateOnly(row.periodStart) }} → {{ dateOnly(row.periodEnd) }}</template>
              <span v-else class="muted">—</span>
            </template>
            <template #cell-status="{ row }"><StatusBadge :status="row.status" kind="generic" /></template>
            <template #cell-total="{ row }"><b class="mono">{{ money(row.totalCents, row.currency) }}</b></template>
            <template #cell-paid="{ row }"><span class="mono text-green">{{ money(row.paidCents, row.currency) }}</span></template>
            <template #cell-balance="{ row }">
              <b class="mono" :class="invBalance(row) > 0 ? 'text-red' : 'text-green'">{{ money(invBalance(row), row.currency) }}</b>
            </template>
            <template #cell-dueAt="{ row }">{{ dateOnly(row.dueAt) }}</template>
        </DataTable>
      </template>
      <EmptyState v-else icon="receipt" title="No invoices yet"
        :hint="billingStatus ? 'Nothing matches this status filter.' : 'Invoices from your eWash subscription will appear here once issued.'" />
    </Panel>

    <Modal v-if="billingDetail" :title="`Invoice ${billingDetail.invoice.number}`" wide @close="billingDetail = null">
      <template #header-extra><StatusBadge :status="billingDetail.invoice.status" kind="generic" /></template>
      <div class="inv-meta">
        <div><span>Billing period</span><b v-if="billingDetail.invoice.periodStart">{{ dateOnly(billingDetail.invoice.periodStart) }} → {{ dateOnly(billingDetail.invoice.periodEnd) }}</b><b v-else>—</b></div>
        <div><span>Issued</span><b>{{ dateOnly(billingDetail.invoice.issuedAt || billingDetail.invoice.createdAt) }}</b></div>
        <div><span>Due</span><b>{{ dateOnly(billingDetail.invoice.dueAt) || '—' }}</b></div>
      </div>
      <div v-for="item in billingDetail.items" :key="item.id" class="inv-lineitem">
        <div class="inv-li-head"><span>{{ item.description }}</span><span>{{ money(item.lineTotalCents, billingDetail.invoice.currency) }}</span></div>
        <div class="inv-li-sub">{{ item.quantity }} × {{ money(item.unitAmountCents, billingDetail.invoice.currency) }}</div>
      </div>
      <div class="inv-totals">
        <div class="tr"><span>Subtotal</span><span>{{ money(billingDetail.invoice.subtotalCents, billingDetail.invoice.currency) }}</span></div>
        <div v-if="billingDetail.invoice.taxCents" class="tr"><span>Tax</span><span>{{ money(billingDetail.invoice.taxCents, billingDetail.invoice.currency) }}</span></div>
        <div class="tr grand"><span>Total</span><span>{{ money(billingDetail.invoice.totalCents, billingDetail.invoice.currency) }}</span></div>
        <div class="tr"><span class="muted">Paid</span><span class="text-green">{{ money(billingDetail.invoice.paidCents, billingDetail.invoice.currency) }}</span></div>
        <div class="tr"><span class="muted">Still to pay</span>
          <b :class="invBalance(billingDetail.invoice) > 0 ? 'text-red' : 'text-green'">{{ money(invBalance(billingDetail.invoice), billingDetail.invoice.currency) }}</b>
        </div>
      </div>
      <h4 class="inv-pay-head">Payments</h4>
      <div v-if="!billingDetail.payments.length" class="muted small">No payments recorded yet. Pay via M-Pesa or bank — the eWash team records it against this invoice.</div>
      <div v-for="p in billingDetail.payments" :key="p.id" class="inv-mini-row">
        <span>{{ p.method.replace('_', ' ') }} · <b>{{ money(p.amountCents, billingDetail.invoice.currency) }}</b>
          <small v-if="p.reference" class="muted"> {{ p.reference }}</small></span>
        <small class="muted">{{ dateTime(p.paidAt) }}</small>
      </div>
      <p v-if="billingDetail.invoice.notes" class="muted small inv-notes">{{ billingDetail.invoice.notes }}</p>
    </Modal>

    <OrderDetailModal v-if="openOrderId" :order-id="openOrderId" @close="openOrderId = null" @changed="load" />

    <ConfirmDialog v-if="voidingExpense" danger :busy="busy"
      title="Void this expense?"
      :message="`This removes ${money(voidingExpense.amountCents, session.currency)} from your books. The change is recorded in the audit log.`"
      confirm-label="Void expense"
      @confirm="voidExpense" @close="voidingExpense = null" />
  </div>
</template>

<style scoped>
.fin-cols { display: grid; grid-template-columns: 1.15fr 1fr; gap: 16px; align-items: start; }
.finance-tabs { display: flex; gap: 4px; padding: 4px; margin-bottom: 14px; border: 1px solid var(--line); border-radius: 11px; background: #edf3f1; overflow-x: auto; }
.finance-tabs button { border: 0; border-radius: 8px; padding: 7px 13px; background: transparent; color: var(--muted); font: 600 11px var(--font-ui); white-space: nowrap; cursor: pointer; }
.finance-tabs button.active { background: #fff; color: var(--brand); box-shadow: 0 2px 8px rgba(14,36,36,.08); }
.actions { display: flex; gap: 8px; margin-top: 12px; }
.pl-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.pl-table td { padding: 8px 6px; border-bottom: 1px solid #f0f4f3; }
.pl-table .indent { padding-left: 24px; }
.pl-table .rule td { border-top: 2px solid var(--line); }
.pl-table .strong td { border-top: 2px solid var(--ink); font-size: 14px; }
/* financial-health panel */
.chart-table { margin-top: 6px; }
.chart-table summary { font-size: 11px; font-weight: 700; color: var(--brand); cursor: pointer; }
.mini-table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-top: 6px; }
.mini-table th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--muted); padding: 4px 6px; border-bottom: 1px solid var(--line); }
.mini-table td { padding: 4px 6px; border-bottom: 1px solid #f0f4f3; }
.cat-head { font-size: 12px; font-weight: 700; margin: 14px 0 8px; padding-top: 12px; border-top: 1px dashed var(--line); }
.cat-row { display: flex; align-items: center; gap: 10px; padding: 3px 0; }
.cat-name { flex: 0 0 32%; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cat-track { flex: 1; background: #eef2f1; border-radius: 4px; height: 8px; }
.cat-bar { height: 8px; background: #0d9488; border-radius: 0 4px 4px 0; }
.cat-amt { font-size: 11.5px; flex: 0 0 auto; }

.ex-filter { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ex-filter select { width: auto; }
.ex-filter .dp-filter { width: 138px; }
.rec-check { display: flex; align-items: center; gap: 8px; font-size: 13px; margin: 4px 0 12px; }
.rec-check input { width: auto; }
.block { display: block; }
.inv { letter-spacing: 0.04em; color: var(--brand-dark); }
.inv-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
.inv-meta > div { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.inv-meta span { display: block; color: var(--muted); font-size: 10px; margin-bottom: 3px; }
.inv-meta b { font-size: 12.5px; }
.inv-lineitem { padding: 9px 0; border-bottom: 1px solid #f0f4f3; }
.inv-li-head { display: flex; justify-content: space-between; font-weight: 600; font-size: 13px; }
.inv-li-sub { color: var(--muted); font-size: 11px; margin-top: 2px; }
.inv-totals { margin: 12px 0; }
.inv-totals .tr { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12.5px; }
.inv-totals .tr.grand { font-weight: 800; font-size: 14.5px; border-top: 1px solid var(--line); margin-top: 5px; padding-top: 7px; }
.inv-pay-head { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin: 12px 0 8px; }
.inv-mini-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f0f4f3; font-size: 12px; flex-wrap: wrap; }
.inv-notes { margin-top: 12px; }
@media (max-width: 980px) { .fin-cols { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .inv-meta { grid-template-columns: 1fr; } }
</style>
