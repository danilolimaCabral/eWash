<script setup>
import { onMounted, ref } from 'vue';
import DataTable from '../components/DataTable.vue';
import FormField from '../components/FormField.vue';
import Modal from '../components/Modal.vue';
import Pagination from '../components/Pagination.vue';
import Panel from '../components/Panel.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { platformApi } from '../platformApi.js';
import { dateOnly, money } from '../utils/format.js';

const rows = ref([]);
const tenants = ref([]);
const total = ref(0);
const offset = ref(0);
const limit = 10;
const status = ref('');
const createOpen = ref(false);
const selected = ref(null);
const error = ref('');
const invoice = ref({ tenant_id: '', description: 'Monthly eWash subscription', quantity: 1, amount: '', tax: 0, due_at: '', notes: '' });
const invoiceErrors = ref({});
const payment = ref({ amount: '', method: 'mpesa_manual', reference: '', paid_at: new Date().toISOString().slice(0, 10) });

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
function openCreate() {
  invoice.value = { tenant_id: '', description: 'Monthly eWash subscription', quantity: 1, amount: '', tax: 0, due_at: '', notes: '' };
  invoiceErrors.value = {};
  createOpen.value = true;
}
function validateInvoice() {
  const e = {};
  if (!invoice.value.tenant_id) e.tenant_id = 'Choose which tenant to bill';
  if (!invoice.value.description?.trim()) e.description = 'Add a line description';
  if (!(Number(invoice.value.quantity) >= 1)) e.quantity = 'Quantity must be at least 1';
  if (!(Number(invoice.value.amount) > 0)) e.amount = 'Enter the unit amount';
  invoiceErrors.value = e;
  return Object.keys(e).length === 0;
}
async function createInvoice() {
  error.value = '';
  if (!validateInvoice()) return;
  try {
    await platformApi.post('/invoices', {
      tenant_id: invoice.value.tenant_id,
      items: [{ description: invoice.value.description, quantity: invoice.value.quantity, unit_amount_cents: Math.round(Number(invoice.value.amount) * 100) }],
      tax_cents: Math.round(Number(invoice.value.tax || 0) * 100),
      due_at: invoice.value.due_at || null,
      notes: invoice.value.notes,
    });
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
onMounted(async () => {
  const tenantResult = await platformApi.get('/tenants?limit=100&offset=0');
  tenants.value = tenantResult.rows;
  await load();
});
</script>

<template>
  <Panel title="Platform billing" subtitle="Subscriptions, invoices and manually recorded collections">
    <template #actions>
      <select v-model="status" class="filter" @change="load(0)"><option value="">All invoices</option><option>draft</option><option>issued</option><option>partially_paid</option><option>paid</option><option>overdue</option><option>void</option></select>
      <button class="btn btn-primary btn-sm" @click="openCreate">+ New invoice</button>
    </template>
    <p v-if="error" class="error-text">{{ error }}</p>
    <DataTable :columns="columns" :rows="rows">
      <template #cell-number="{ row }"><router-link class="invoice-link" :to="{ name: 'platform-invoice', params: { id: row.id } }">{{ row.number }}</router-link><small>{{ dateOnly(row.createdAt) }}</small></template>
      <template #cell-status="{ row }"><StatusBadge :status="row.status" kind="generic" /></template>
      <template #cell-total="{ row }">{{ money(row.totalCents, row.currency) }}</template>
      <template #cell-balance="{ row }"><b>{{ money(row.totalCents - row.paidCents, row.currency) }}</b></template>
      <template #cell-dueAt="{ row }"><span>{{ dateOnly(row.dueAt) }}</span><div class="row-actions"><button v-if="row.status === 'draft'" @click="issue(row)">Issue</button><button v-if="['issued','partially_paid','overdue'].includes(row.status)" @click="selected = row; payment.amount = (row.totalCents-row.paidCents)/100">Pay</button></div></template>
    </DataTable>
    <Pagination :total="total" :limit="limit" :offset="offset" @change="load" />
  </Panel>

  <Modal v-if="createOpen" title="Create tenant invoice" @close="createOpen = false">
    <div class="form-grid">
      <FormField label="Tenant" :error="invoiceErrors.tenant_id">
        <select v-model="invoice.tenant_id" @change="invoiceErrors.tenant_id = ''"><option disabled value="">Select tenant</option><option v-for="tenant in tenants" :key="tenant.id" :value="tenant.id">{{ tenant.name }}</option></select>
      </FormField>
      <FormField label="Due date"><input v-model="invoice.due_at" type="date" /></FormField>
      <FormField label="Description" :error="invoiceErrors.description"><input v-model="invoice.description" type="text" @input="invoiceErrors.description = ''" /></FormField>
      <FormField label="Quantity" :error="invoiceErrors.quantity"><input v-model.number="invoice.quantity" type="number" min="1" @input="invoiceErrors.quantity = ''" /></FormField>
      <FormField label="Unit amount (KES)" :error="invoiceErrors.amount"><input v-model="invoice.amount" type="number" min="0" step="1" @input="invoiceErrors.amount = ''" /></FormField>
      <FormField label="Tax (KES)" hint="Defaults to 0"><input v-model="invoice.tax" type="number" min="0" step="1" /></FormField>
    </div>
    <FormField label="Notes"><textarea v-model="invoice.notes" rows="2" /></FormField>
    <template #footer><button class="btn btn-outline" @click="createOpen = false">Cancel</button><button class="btn btn-primary" @click="createInvoice">Save draft</button></template>
  </Modal>

  <Modal v-if="selected" :title="`Record payment · ${selected.number}`" @close="selected = null">
    <div class="form-grid">
      <FormField label="Amount (KES)"><input v-model="payment.amount" type="number" min="1" step="1" /></FormField>
      <FormField label="Payment date"><input v-model="payment.paid_at" type="date" /></FormField>
      <FormField label="Method"><select v-model="payment.method"><option value="mpesa_manual">M-Pesa code (manual)</option><option value="bank">Bank transfer</option><option value="cash">Cash</option></select></FormField>
      <FormField label="Reference"><input v-model="payment.reference" type="text" placeholder="M-Pesa code or bank reference" /></FormField>
    </div>
    <template #footer><button class="btn btn-outline" @click="selected = null">Cancel</button><button class="btn btn-primary" :disabled="!payment.amount" @click="recordPayment">Record payment</button></template>
  </Modal>
</template>

<style scoped>
.filter{height:34px;border:1px solid var(--line);border-radius:8px;padding:0 8px;background:#fff}.invoice-link{color:var(--brand-dark);font-weight:700;text-decoration:none}.invoice-link:hover{text-decoration:underline}small{display:block;color:var(--muted);font-size:9px}.row-actions{display:flex;gap:6px;margin-top:3px}.row-actions button{padding:0;border:0;background:none;color:var(--brand);font:600 10px var(--font-ui);cursor:pointer}.form-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}textarea{width:100%;resize:vertical}@media(max-width:560px){.form-grid{grid-template-columns:1fr}}
</style>
