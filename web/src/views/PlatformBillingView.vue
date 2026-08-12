<script setup>
import { computed, onMounted, ref } from 'vue';
import DataTable from '../components/DataTable.vue';
import FormField from '../components/FormField.vue';
import DatePicker from '../components/DatePicker.vue';
import Modal from '../components/Modal.vue';
import Panel from '../components/Panel.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { platformApi } from '../platformApi.js';
import { dateOnly, money } from '../utils/format.js';

const rows = ref([]);
const tenants = ref([]);
const plans = ref([]);
const total = ref(0);
const offset = ref(0);
const limit = 8;
const status = ref('');
const createOpen = ref(false);
const selected = ref(null);
const error = ref('');
const invoiceMode = ref('plan'); // plan | manual
const invoice = ref({ tenant_id: '', description: 'Monthly LavTr subscription', quantity: 1, amount: '', tax: 0, due_at: '', notes: '' });
const invoiceErrors = ref({});
const payment = ref({ amount: '', method: 'pix_manual', reference: '', paid_at: new Date().toISOString().slice(0, 10) });
const subPreview = ref(null); // { planName, termMonths, perMonthCents, periodStart, periodEnd, custom }
const planEdit = ref(null); // { id, name, trial_days, active, prices: [{term_months, price_kes}] }
const planErrors = ref('');

const columns = [
  { key: 'number', label: 'Invoice' }, { key: 'tenantName', label: 'Tenant' },
  { key: 'status', label: 'Status' }, { key: 'total', label: 'Total', align: 'right' },
  { key: 'balance', label: 'Balance', align: 'right' }, { key: 'dueAt', label: 'Due' },
];

async function load(nextOffset = 0) {
  offset.value = nextOffset;
  const params = new URLSearchParams({ limit, offset: nextOffset });
  if (status.value) params.set('status', status.value);
  try {
    const result = await platformApi.get(`/invoices?${params}`);
    rows.value = result.rows;
    total.value = result.total;
  } catch (e) { error.value = e.message; }
}

async function loadPlans() {
  plans.value = await platformApi.get('/plans');
}

// ---- Plans & pricing ----
function editPlan(plan) {
  planErrors.value = '';
  planEdit.value = {
    id: plan.id, name: plan.name, trial_days: plan.trialDays, active: !!plan.active,
    prices: plan.prices.map((p) => ({ term_months: p.termMonths, price_kes: p.priceCents / 100 })),
  };
}
function addTerm() {
  planEdit.value.prices.push({ term_months: '', price_kes: '' });
}
async function savePlan() {
  planErrors.value = '';
  try {
    await platformApi.patch(`/plans/${planEdit.value.id}`, {
      name: planEdit.value.name,
      trial_days: planEdit.value.trial_days,
      active: planEdit.value.active,
      prices: planEdit.value.prices
        .filter((p) => p.term_months !== '' && p.price_kes !== '')
        .map((p) => ({ term_months: Number(p.term_months), price_cents: Math.round(Number(p.price_kes) * 100) })),
    });
    planEdit.value = null;
    await loadPlans();
  } catch (e) { planErrors.value = e.message; }
}
const termSummary = (plan) => plan.prices.map((p) => `${p.termMonths}mo ${money(p.priceCents, 'KES')}/mo`).join(' · ');

// ---- Invoice creation ----
function openCreate() {
  invoiceMode.value = 'plan';
  invoice.value = { tenant_id: '', description: 'Monthly LavTr subscription', quantity: 1, amount: '', tax: 0, due_at: '', notes: '' };
  invoiceErrors.value = {};
  subPreview.value = null;
  createOpen.value = true;
}

// preview what /invoices/generate will bill: the tenant's subscription priced
// from the CURRENT plan config (server recomputes authoritatively on submit)
async function loadSubPreview() {
  subPreview.value = null;
  invoiceErrors.value = {};
  if (!invoice.value.tenant_id) return;
  const detail = await platformApi.get(`/tenants/${invoice.value.tenant_id}`);
  const sub = (detail.subscriptions || []).find((s) => s.status !== 'cancelled');
  if (!sub) {
    invoiceErrors.value.tenant_id = 'No subscription — assign a plan in Tenants first';
    return;
  }
  const plan = plans.value.find((p) => p.id === sub.planId);
  const termPrice = plan?.prices.find((p) => p.termMonths === sub.termMonths);
  const perMonthCents = sub.customPriceCents ?? termPrice?.priceCents;
  if (perMonthCents == null) {
    invoiceErrors.value.tenant_id = `${plan?.name || 'Plan'} has no ${sub.termMonths}-month price — configure it under Plans & pricing`;
    return;
  }
  subPreview.value = {
    planName: plan?.name || sub.planId, termMonths: sub.termMonths, perMonthCents,
    periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd,
    custom: sub.customPriceCents != null,
  };
}

function validateInvoice() {
  const e = {};
  if (!invoice.value.tenant_id) e.tenant_id = 'Choose which tenant to bill';
  if (invoiceMode.value === 'manual') {
    if (!invoice.value.description?.trim()) e.description = 'Add a line description';
    if (!(Number(invoice.value.quantity) >= 1)) e.quantity = 'Quantity must be at least 1';
    if (!(Number(invoice.value.amount) > 0)) e.amount = 'Enter the unit amount';
  } else if (!subPreview.value) {
    e.tenant_id = invoiceErrors.value.tenant_id || 'Choose a tenant with a subscription';
  }
  invoiceErrors.value = e;
  return Object.keys(e).length === 0;
}

async function createInvoice() {
  error.value = '';
  if (!validateInvoice()) return;
  try {
    if (invoiceMode.value === 'plan') {
      await platformApi.post('/invoices/generate', {
        tenant_id: invoice.value.tenant_id,
        due_at: invoice.value.due_at || null,
      });
    } else {
      await platformApi.post('/invoices', {
        tenant_id: invoice.value.tenant_id,
        items: [{ description: invoice.value.description, quantity: invoice.value.quantity, unit_amount_cents: Math.round(Number(invoice.value.amount) * 100) }],
        tax_cents: Math.round(Number(invoice.value.tax || 0) * 100),
        due_at: invoice.value.due_at || null,
        notes: invoice.value.notes,
      });
    }
    createOpen.value = false;
    await load(0);
  } catch (e) { error.value = e.message; }
}

async function issue(row) {
  await platformApi.patch(`/invoices/${row.id}`, { status: 'issued' });
  await load(offset.value);
}
async function recordPayment() {
  await platformApi.post(`/invoices/${selected.value.id}/payments`, {
    amount_cents: Math.round(Number(payment.value.amount) * 100),
    method: payment.value.method, reference: payment.value.reference, paid_at: payment.value.paid_at,
  });
  selected.value = null;
  await load(offset.value);
}
const previewTotal = computed(() => subPreview.value ? subPreview.value.termMonths * subPreview.value.perMonthCents : 0);

onMounted(async () => {
  const [tenantResult] = await Promise.all([platformApi.get('/tenants?limit=100&offset=0'), loadPlans(), load()]);
  tenants.value = tenantResult.rows;
});
</script>

<template>
  <Panel title="Plans & pricing" subtitle="Per-month rates by commitment — longer terms cost less · edits apply to invoices generated afterwards">
    <div class="plan-grid">
      <div v-for="plan in plans" :key="plan.id" class="plan-card">
        <div class="plan-head">
          <b>{{ plan.name }}</b>
          <StatusBadge :status="plan.active ? 'active' : 'inactive'" kind="generic" />
        </div>
        <p class="plan-terms">{{ termSummary(plan) }}</p>
        <small class="muted">Trial: {{ plan.trialDays }} days</small>
        <button class="btn btn-outline btn-sm" @click="editPlan(plan)">Edit pricing</button>
      </div>
    </div>
  </Panel>

  <Panel title="Platform billing" subtitle="Subscriptions, invoices and manually recorded collections">
    <template #actions>
      <select v-model="status" class="filter" @change="load(0)"><option value="">All invoices</option><option>draft</option><option>issued</option><option>partially_paid</option><option>paid</option><option>overdue</option><option>void</option></select>
      <button class="btn btn-primary btn-sm" @click="openCreate">+ New invoice</button>
    </template>
    <p v-if="error" class="error-text">{{ error }}</p>
    <DataTable :columns="columns" :page="{ rows, total, limit, offset }" @page="load">
      <template #cell-number="{ row }"><router-link class="invoice-link" :to="{ name: 'platform-invoice', params: { id: row.id } }">{{ row.number }}</router-link><small>{{ dateOnly(row.createdAt) }}</small></template>
      <template #cell-status="{ row }"><StatusBadge :status="row.status" kind="generic" /></template>
      <template #cell-total="{ row }">{{ money(row.totalCents, row.currency) }}</template>
      <template #cell-balance="{ row }"><b>{{ money(row.totalCents - row.paidCents, row.currency) }}</b></template>
      <template #cell-dueAt="{ row }"><span>{{ dateOnly(row.dueAt) }}</span><div class="row-actions"><button v-if="row.status === 'draft'" @click="issue(row)">Issue</button><button v-if="['issued','partially_paid','overdue'].includes(row.status)" @click="selected = row; payment.amount = (row.totalCents-row.paidCents)/100">Pay</button></div></template>
    </DataTable>
  </Panel>

  <Modal v-if="planEdit" :title="`Edit plan · ${planEdit.name}`" @close="planEdit = null">
    <div class="form-grid">
      <FormField label="Plan name"><input v-model="planEdit.name" type="text" /></FormField>
      <FormField label="Trial days"><input v-model.number="planEdit.trial_days" type="number" min="0" max="90" /></FormField>
    </div>
    <FormField label="Status"><select v-model="planEdit.active"><option :value="true">Active</option><option :value="false">Inactive</option></select></FormField>
    <div class="terms-head"><b>Term pricing</b><small class="muted">Price per month when paying for the whole term upfront</small></div>
    <div v-for="(price, i) in planEdit.prices" :key="i" class="term-row">
      <FormField label="Months"><input v-model.number="price.term_months" type="number" min="1" max="24" /></FormField>
      <FormField label="KES / month"><input v-model.number="price.price_kes" type="number" min="0" step="1" /></FormField>
      <span class="term-total muted small">= {{ price.term_months && price.price_kes ? money(price.term_months * price.price_kes * 100, 'KES') : '—' }}</span>
      <button class="term-remove" title="Remove term" @click="planEdit.prices.splice(i, 1)">✕</button>
    </div>
    <button class="btn btn-ghost btn-sm" @click="addTerm">+ Add term</button>
    <p v-if="planErrors" class="error-text">{{ planErrors }}</p>
    <template #footer><button class="btn btn-outline" @click="planEdit = null">Cancel</button><button class="btn btn-primary" @click="savePlan">Save plan</button></template>
  </Modal>

  <Modal v-if="createOpen" title="Create tenant invoice" @close="createOpen = false">
    <div class="mode-switch">
      <button :class="{ active: invoiceMode === 'plan' }" @click="invoiceMode = 'plan'">From subscription plan</button>
      <button :class="{ active: invoiceMode === 'manual' }" @click="invoiceMode = 'manual'">Manual line</button>
    </div>
    <div class="form-grid">
      <FormField label="Tenant" :error="invoiceErrors.tenant_id">
        <select v-model="invoice.tenant_id" @change="invoiceMode === 'plan' ? loadSubPreview() : (invoiceErrors.tenant_id = '')"><option disabled value="">Select tenant</option><option v-for="tenant in tenants" :key="tenant.id" :value="tenant.id">{{ tenant.name }}</option></select>
      </FormField>
      <FormField label="Due date" :hint="invoiceMode === 'plan' ? 'Defaults to period start + 7 days' : ''"><DatePicker v-model="invoice.due_at" /></FormField>
    </div>
    <template v-if="invoiceMode === 'plan'">
      <div v-if="subPreview" class="sub-preview">
        <div><span>Plan</span><b>{{ subPreview.planName }} · {{ subPreview.termMonths }} months</b></div>
        <div><span>Rate{{ subPreview.custom ? ' (custom)' : '' }}</span><b>{{ money(subPreview.perMonthCents, 'KES') }}/mo</b></div>
        <div><span>Period</span><b>{{ subPreview.periodStart }} → {{ subPreview.periodEnd }}</b></div>
        <div><span>Invoice total</span><b class="preview-total">{{ money(previewTotal, 'KES') }}</b></div>
      </div>
      <p v-else class="muted small">Pick a tenant — the invoice line is generated from their plan's current term pricing.</p>
    </template>
    <template v-else>
      <div class="form-grid">
        <FormField label="Description" :error="invoiceErrors.description"><input v-model="invoice.description" type="text" @input="invoiceErrors.description = ''" /></FormField>
        <FormField label="Quantity" :error="invoiceErrors.quantity"><input v-model.number="invoice.quantity" type="number" min="1" @input="invoiceErrors.quantity = ''" /></FormField>
        <FormField label="Unit amount (KES)" :error="invoiceErrors.amount"><input v-model="invoice.amount" type="number" min="0" step="1" @input="invoiceErrors.amount = ''" /></FormField>
        <FormField label="Tax (KES)" hint="Defaults to 0"><input v-model="invoice.tax" type="number" min="0" step="1" /></FormField>
      </div>
      <FormField label="Notes"><textarea v-model="invoice.notes" rows="2" /></FormField>
    </template>
    <template #footer><button class="btn btn-outline" @click="createOpen = false">Cancel</button><button class="btn btn-primary" @click="createInvoice">{{ invoiceMode === 'plan' ? 'Generate invoice' : 'Save draft' }}</button></template>
  </Modal>

  <Modal v-if="selected" :title="`Record payment · ${selected.number}`" @close="selected = null">
    <div class="form-grid">
      <FormField label="Amount (KES)"><input v-model="payment.amount" type="number" min="1" step="1" /></FormField>
      <FormField label="Payment date"><DatePicker v-model="payment.paid_at" /></FormField>
      <FormField label="Method"><select v-model="payment.method"><option value="pix_manual">Código Pix (manual)</option><option value="bank">Transferência bancária</option><option value="cash">Dinheiro</option></select></FormField>
      <FormField label="Referência"><input v-model="payment.reference" type="text" placeholder="Código Pix ou referência bancária" /></FormField>
    </div>
    <template #footer><button class="btn btn-outline" @click="selected = null">Cancel</button><button class="btn btn-primary" :disabled="!payment.amount" @click="recordPayment">Record payment</button></template>
  </Modal>
</template>

<style scoped>
.filter{height:34px;border:1px solid var(--line);border-radius:8px;padding:0 8px;background:#fff}.invoice-link{color:var(--brand-dark);font-weight:700;text-decoration:none}.invoice-link:hover{text-decoration:underline}small{display:block;color:var(--muted);font-size:9px}.row-actions{display:flex;gap:6px;margin-top:3px}.row-actions button{padding:0;border:0;background:none;color:var(--brand);font:600 10px var(--font-ui);cursor:pointer}.form-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}textarea{width:100%;resize:vertical}
.plan-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.plan-card{border:1px solid var(--line);border-radius:11px;padding:13px;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.plan-head{display:flex;justify-content:space-between;align-items:center;width:100%}
.plan-head b{font:700 14px var(--font-ui)}
.plan-terms{font-size:11px;color:var(--ink);line-height:1.6}
.plan-card .btn{margin-top:auto}
.terms-head{margin:14px 0 8px}.terms-head small{font-size:10.5px}
.term-row{display:grid;grid-template-columns:1fr 1fr auto auto;gap:10px;align-items:center;margin-bottom:2px}
.term-total{white-space:nowrap;padding-top:8px}
.term-remove{border:0;background:none;color:var(--muted);cursor:pointer;font-size:12px;padding:8px 2px 0}
.term-remove:hover{color:var(--red)}
.mode-switch{display:flex;gap:4px;background:#f0f5f4;border-radius:9px;padding:4px;margin-bottom:14px}
.mode-switch button{flex:1;border:0;background:none;padding:8px;font:700 12px var(--font-ui);color:var(--muted);border-radius:7px;cursor:pointer}
.mode-switch button.active{background:#fff;color:var(--brand-dark);box-shadow:0 1px 4px rgba(0,0,0,.08)}
.sub-preview{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:4px}
.sub-preview>div{border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.sub-preview span{display:block;color:var(--muted);font-size:10px;margin-bottom:3px}
.sub-preview b{font-size:12.5px}
.preview-total{color:var(--brand-dark);font-size:15px}
@media(max-width:700px){.plan-grid{grid-template-columns:1fr}}
@media(max-width:560px){.form-grid,.sub-preview{grid-template-columns:1fr}.term-row{grid-template-columns:1fr 1fr auto auto}}
</style>
