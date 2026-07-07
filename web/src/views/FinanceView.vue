<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { money, monthNow, monthLabel, dateOnly, recentMonths } from '../utils/format.js';
import KpiCard from '../components/KpiCard.vue';
import Panel from '../components/Panel.vue';
import DataTable from '../components/DataTable.vue';
import FormField from '../components/FormField.vue';
import StatusBadge from '../components/StatusBadge.vue';
import Skeleton from '../components/Skeleton.vue';
import OrderDetailModal from '../components/OrderDetailModal.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';


const session = useSession();
const toast = useToast();
const month = ref(monthNow());
const pl = ref(null);
const expenses = ref(null); // null = first load (skeleton)
const categories = ref([]);
const busy = ref(false);
const activeTab = ref('overview');
const providers = ref([]);
const credit = ref([]);
const editingExpenseId = ref(null);
const exForm = ref({ category_id: '', provider_id: '', amount: 2500, paid_via: 'mpesa', expense_date: new Date().toLocaleDateString('sv-SE'), note: '', recurring: false });
const providerForm = ref({ id: '', name: '', service_type: '', phone: '', email: '', notes: '', active: true });
const openOrderId = ref(null);

async function load() {
  try {
    const [plData, exData, catData, providerData, creditData] = await Promise.all([
      api.get(`/finance/pl?month=${month.value}`),
      api.get(`/expenses?month=${month.value}`),
      api.get('/expense-categories'),
      api.get('/service-providers'),
      api.get('/credit-ledger'),
    ]);
    pl.value = plData;
    expenses.value = exData;
    categories.value = catData;
    providers.value = providerData;
    credit.value = creditData;
    if (!exForm.value.category_id) exForm.value.category_id = catData[0]?.id || '';
    if (plData.autoPostedRecurring) toast.show(`${plData.autoPostedRecurring} recurring expense(s) auto-posted for this month — review below`);
  } catch (e) { toast.error(e.message); }
}
onMounted(load);

const months = computed(() => recentMonths(12));

const momDelta = computed(() => {
  if (!pl.value?.previous) return '';
  const prev = pl.value.previous.netCents;
  if (!prev) return 'no prior month data';
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
    toast.success(editingExpenseId.value ? 'Expense updated and audit-logged' : 'Expense saved ✔ — P&L updated' + (exForm.value.recurring ? ' · will auto-post monthly' : ''));
    editingExpenseId.value = null;
    exForm.value.note = '';
    exForm.value.recurring = false;
    await load();
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}

function editExpense(row) {
  editingExpenseId.value = row.id;
  exForm.value = {
    category_id: row.categoryId, provider_id: row.providerId || '', amount: row.amountCents / 100,
    paid_via: row.paidVia, expense_date: row.expenseDate.slice(0, 10), note: row.note || '', recurring: !!row.recurring,
  };
  activeTab.value = 'expenses';
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
    toast.success('Service provider saved');
    await load();
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}

function editProvider(row) {
  providerForm.value = { id: row.id, name: row.name, service_type: row.serviceType, phone: row.phone || '', email: row.email || '', notes: row.notes || '', active: !!row.active };
}

function exportCsv() {
  if (!pl.value) return;
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
    ...expenses.value.map((e) => [e.expenseDate, e.categoryName, e.amountCents / 100, e.paidVia, e.note || '']),
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
  { key: 'balance', label: 'Outstanding', align: 'right' }, { key: 'creditDueAt', label: 'Due' },
];
</script>

<template>
  <div>
    <div class="section-head">
      <div>
        <h2>Finance — Profit &amp; Loss</h2>
        <p>Owner only · Revenue recognized on <b>closed orders</b> (delivered/collected)</p>
      </div>
      <div class="head-actions">
        <select v-model="month" style="width: 170px;" @change="load">
          <option v-for="m in months" :key="m" :value="m">{{ monthLabel(m) }}</option>
        </select>
        <button class="btn btn-ghost" @click="exportCsv">Export CSV</button>
      </div>
    </div>

    <div class="finance-tabs">
      <button v-for="tab in [{ key: 'overview', label: 'Overview' }, { key: 'expenses', label: 'Expenses' }, { key: 'credit', label: 'Customer credit' }, { key: 'providers', label: 'Service providers' }]"
        :key="tab.key" :class="{ active: activeTab === tab.key }" @click="activeTab = tab.key">{{ tab.label }}</button>
    </div>

    <div v-if="activeTab === 'overview' && !pl" class="cards"><Skeleton variant="kpi" :count="4" /></div>
    <div v-else-if="activeTab === 'overview'" class="cards">
      <KpiCard label="Net revenue · closed orders only" :value="money(pl.netCents, session.currency)" icon="finance" icon-tone="green"
        :delta="momDelta" :delta-kind="pl.netCents >= (pl.previous?.netCents || 0) ? 'up' : 'down'" />
      <KpiCard label="Expenses" :value="money(pl.expensesCents, session.currency)" icon="cash" icon-tone="orange"
        :delta="`${expenses?.length ?? 0} entries`" />
      <KpiCard label="Operating profit" :value="money(pl.profitCents, session.currency)" icon="chart" icon-tone="violet"
        :delta="`${pl.marginPct}% margin`" :delta-kind="pl.profitCents >= 0 ? 'up' : 'down'" />
      <KpiCard label="Billed vs collected" :value="money(pl.collectedCents, session.currency)" icon="clock" icon-tone="blue"
        :delta="pl.receivablesCents > 0 ? `${money(pl.receivablesCents, session.currency)} still to chase` : 'all collected'"
        :delta-kind="pl.receivablesCents > 0 ? 'down' : 'up'" />
    </div>

    <div class="fin-cols">
      <Panel v-if="activeTab === 'overview'" :title="`P&L statement — ${monthLabel(month)}`"
        :subtitle="`${pl?.closedOrders ?? 0} closed orders${pl?.rewashCount ? ` · ${pl.rewashCount} re-wash redo` : ''}`">
        <Skeleton v-if="!pl" variant="table" :count="6" />
        <table v-else class="pl-table">
          <tbody>
            <tr><td><b>Gross revenue</b> <span class="muted small">(closed orders — automatic)</span></td><td class="text-right mono">{{ money(pl.grossCents, session.currency) }}</td></tr>
            <tr><td class="indent">less Discounts</td><td class="text-right mono text-red">({{ money(pl.discountsCents, session.currency) }})</td></tr>
            <tr><td class="indent">less Refunds &amp; re-wash</td><td class="text-right mono text-red">({{ money(pl.refundsCents, session.currency) }})</td></tr>
            <tr class="rule"><td><b>Net revenue</b></td><td class="text-right mono"><b>{{ money(pl.netCents, session.currency) }}</b></td></tr>
            <tr v-for="e in pl.expensesByCategory" :key="e.category">
              <td class="indent">less {{ e.category }}</td>
              <td class="text-right mono text-red">({{ money(e.amountCents, session.currency) }})</td>
            </tr>
            <tr class="rule strong">
              <td><b>Operating profit</b></td>
              <td class="text-right mono"><b :class="pl.profitCents >= 0 ? 'text-green' : 'text-red'">{{ money(pl.profitCents, session.currency) }}</b></td>
            </tr>
          </tbody>
        </table>
      </Panel>

      <div v-if="activeTab === 'expenses'">
        <Panel title="Record expense" v-if="session.can('expenses.create')">
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
            <FormField label="Date"><input v-model="exForm.expense_date" type="date" /></FormField>
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
            <input v-model="exForm.recurring" type="checkbox" /> Recurring monthly (auto-posts with a nudge)
          </label>
          <button class="btn btn-primary" :disabled="busy" @click="saveExpense">{{ editingExpenseId ? 'Update expense' : 'Save expense' }}</button>
          <button v-if="editingExpenseId" class="btn btn-ghost" @click="editingExpenseId = null">Cancel edit</button>
        </Panel>

        <Panel title="Expenses this month">
          <Skeleton v-if="!expenses" variant="table" :count="4" />
          <DataTable v-else :columns="exColumns" :rows="expenses" empty-text="No expenses recorded this month.">
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
      </div>
    </div>

    <Panel v-if="activeTab === 'credit'" title="Customer credit ledger" subtitle="Payments are applied to the selected order">
      <DataTable :columns="creditColumns" :rows="credit.filter((r) => r.totalCents > r.paidCents)" clickable
        empty-text="No customer credit is outstanding." @row-click="(row) => openOrderId = row.orderId">
        <template #cell-code="{ row }"><b>{{ row.code }}</b></template>
        <template #cell-customerName="{ row }">{{ row.customerName }}<small class="muted block">{{ row.customerPhone }}</small></template>
        <template #cell-balance="{ row }"><b class="text-red mono">{{ money(row.totalCents - row.paidCents, session.currency) }}</b></template>
        <template #cell-creditDueAt="{ row }"><span :class="{ 'text-red': row.creditDueAt && row.creditDueAt < new Date().toISOString() }">{{ dateOnly(row.creditDueAt) }}</span></template>
      </DataTable>
    </Panel>

    <div v-if="activeTab === 'providers'" class="provider-grid">
      <Panel :title="providerForm.id ? 'Edit provider' : 'Add service provider'">
        <div class="row"><FormField label="Name"><input v-model="providerForm.name" type="text" /></FormField><FormField label="Service type"><input v-model="providerForm.service_type" type="text" placeholder="Delivery, water, maintenance…" /></FormField></div>
        <div class="row"><FormField label="Phone"><input v-model="providerForm.phone" type="tel" /></FormField><FormField label="Email"><input v-model="providerForm.email" type="email" /></FormField></div>
        <FormField label="Notes"><input v-model="providerForm.notes" type="text" /></FormField>
        <div class="actions"><button class="btn btn-primary" :disabled="busy" @click="saveProvider">Save provider</button><button v-if="providerForm.id" class="btn btn-ghost" @click="providerForm = { id: '', name: '', service_type: '', phone: '', email: '', notes: '', active: true }">Cancel</button></div>
      </Panel>
      <Panel title="Provider directory">
        <button v-for="p in providers" :key="p.id" class="provider-row" @click="editProvider(p)"><span><b>{{ p.name }}</b><small>{{ p.serviceType }} · {{ p.phone || p.email || 'No contact' }}</small></span><span>{{ p.active ? 'Active' : 'Inactive' }}</span></button>
      </Panel>
    </div>
    <OrderDetailModal v-if="openOrderId" :order-id="openOrderId" @close="openOrderId = null" @changed="load" />

    <ConfirmDialog v-if="voidingExpense" danger :busy="busy"
      title="Void this expense?"
      :message="`This removes ${money(voidingExpense.amountCents, session.currency)} from the P&L and is written to the audit log.`"
      confirm-label="Void expense"
      @confirm="voidExpense" @close="voidingExpense = null" />
  </div>
</template>

<style scoped>
.fin-cols { display: grid; grid-template-columns: 1.15fr 1fr; gap: 16px; align-items: start; }
.finance-tabs { display: flex; gap: 4px; padding: 4px; margin-bottom: 14px; border: 1px solid var(--line); border-radius: 11px; background: #edf3f1; overflow-x: auto; }
.finance-tabs button { border: 0; border-radius: 8px; padding: 7px 13px; background: transparent; color: var(--muted); font: 600 11px var(--font-ui); white-space: nowrap; cursor: pointer; }
.finance-tabs button.active { background: #fff; color: var(--brand); box-shadow: 0 2px 8px rgba(14,36,36,.08); }
.provider-grid { display: grid; grid-template-columns: minmax(300px, .8fr) minmax(0, 1.2fr); gap: 14px; }
.provider-row { width: 100%; display: flex; justify-content: space-between; gap: 10px; padding: 9px; border: 0; border-bottom: 1px solid var(--line); background: none; text-align: left; font-family: inherit; cursor: pointer; }
.provider-row b, .provider-row small { display: block; }.provider-row small { color: var(--muted); font-size: 10px; }
.actions { display: flex; gap: 8px; margin-top: 12px; }
.pl-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.pl-table td { padding: 8px 6px; border-bottom: 1px solid #f0f4f3; }
.pl-table .indent { padding-left: 24px; }
.pl-table .rule td { border-top: 2px solid var(--line); }
.pl-table .strong td { border-top: 2px solid var(--ink); font-size: 14px; }
.rec-check { display: flex; align-items: center; gap: 8px; font-size: 13px; margin: 4px 0 12px; }
.rec-check input { width: auto; }
.block { display: block; }
@media (max-width: 980px) { .fin-cols, .provider-grid { grid-template-columns: 1fr; } }
</style>
