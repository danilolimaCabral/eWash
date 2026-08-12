<script setup>
import { ref, onMounted, watch } from 'vue';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { money, dateOnly, timeAgo } from '../utils/format.js';
import Panel from '../components/Panel.vue';
import DataTable from '../components/DataTable.vue';
import Avatar from '../components/Avatar.vue';
import Modal from '../components/Modal.vue';
import FormField from '../components/FormField.vue';
import StatusBadge from '../components/StatusBadge.vue';
import AppIcon from '../components/AppIcon.vue';
import OrderDetailModal from '../components/OrderDetailModal.vue';


const session = useSession();
const toast = useToast();
const custPage = ref(null); // { rows, total, limit, offset } — null = loading
const q = ref('');
const CUST_LIMIT = 20;
const addOpen = ref(false);
const addForm = ref({ name: '', phone: '', notes: '' });
const detail = ref(null);
const openOrderId = ref(null);
const busy = ref(false);
const creditForm = ref({ enabled: false, limit: 0, terms: 30 });

async function load(nextOffset = 0) {
  try {
    const params = new URLSearchParams({ limit: CUST_LIMIT, offset: nextOffset });
    if (q.value.trim()) params.set('q', q.value.trim());
    custPage.value = await api.get(`/customers?${params}`);
  } catch (e) { toast.error(e.message); }
}
onMounted(load);

// search is server-side — debounce keystrokes into one request
let qTimer;
watch(q, () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => load(0), 300);
});

// a customer is "lapsing" if their last order is 30+ days old
const isLapsing = (c) =>
  c.lastOrderAt && (Date.now() - new Date(c.lastOrderAt.replace(' ', 'T') + 'Z').getTime()) > 30 * 86400_000;

async function saveCustomer() {
  busy.value = true;
  try {
    await api.post('/customers', addForm.value);
    addOpen.value = false;
    addForm.value = { name: '', phone: '', notes: '' };
    toast.success('Cliente criado');
    await load();
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}

async function openDetail(row) {
  try {
    detail.value = await api.get(`/customers/${row.id}`);
    creditForm.value = { enabled: !!detail.value.creditEnabled, limit: detail.value.creditLimitCents / 100, terms: detail.value.creditTermsDays };
  }
  catch (e) { toast.error(e.message); }
}

async function saveCredit() {
  busy.value = true;
  try {
    await api.patch(`/customers/${detail.value.id}`, {
      credit_enabled: creditForm.value.enabled,
      credit_limit_cents: Math.round(creditForm.value.limit * 100),
      credit_terms_days: creditForm.value.terms,
    });
    toast.success('Customer credit settings saved and audit-logged');
    await openDetail(detail.value);
    await load();
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'orderCount', label: 'Pedidos', align: 'right' },
  { key: 'ltv', label: 'Valor acumulado', align: 'right' },
  { key: 'last', label: 'Último pedido' },
];
</script>

<template>
  <div>
    <div class="section-head">
      <div>
        <h2>Customers</h2>
        <p>Phone number is the customer ID — auto-created at first order</p>
      </div>
      <div class="head-actions">
        <input v-model="q" type="search" placeholder="Search name or phone…" style="width: 220px;" />
        <button class="btn btn-primary" @click="addOpen = true"><AppIcon name="plus" :size="14" /> Add customer</button>
      </div>
    </div>

    <Panel>
      <DataTable :columns="columns" :page="custPage" clickable :skeleton-count="5"
        empty-text="No customers yet — they are created automatically with their first order."
        @page="load" @row-click="openDetail">
        <template #cell-name="{ row }">
          <span class="cust"><Avatar :name="row.name" /> <b>{{ row.name }}</b></span>
        </template>
        <template #cell-orderCount="{ row }"><span class="mono">{{ row.orderCount }}</span></template>
        <template #cell-ltv="{ row }"><b class="mono">{{ money(row.lifetimeValueCents, session.currency) }}</b></template>
        <template #cell-last="{ row }">
          {{ row.lastOrderAt ? timeAgo(row.lastOrderAt) : 'never' }}
          <StatusBadge v-if="isLapsing(row)" status="unpaid" kind="generic" label="lapsing" />
        </template>
      </DataTable>
    </Panel>

    <Modal v-if="addOpen" title="New customer" @close="addOpen = false">
      <div class="row">
        <FormField label="Name"><input v-model="addForm.name" type="text" /></FormField>
        <FormField label="Phone"><input v-model="addForm.phone" type="tel" placeholder="07xx xxx xxx" /></FormField>
      </div>
      <div class="row">
        <FormField label="Notes"><input v-model="addForm.notes" type="text" placeholder="e.g. prefers softener" /></FormField>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="addOpen = false">Cancel</button>
        <button class="btn btn-primary" :disabled="busy" @click="saveCustomer">Save customer</button>
      </template>
    </Modal>

    <Modal v-if="detail" :title="detail.name" wide @close="detail = null">
      <p class="muted small" style="margin-bottom: 12px;">
        {{ detail.phone }} · customer since {{ dateOnly(detail.createdAt) }}
        <template v-if="detail.notes"> · {{ detail.notes }}</template>
      </p>
      <div v-if="session.can('finance.manage')" class="credit-settings">
        <label><input v-model="creditForm.enabled" type="checkbox" /> Allow this customer to collect on credit</label>
        <FormField :label="`Credit limit (${session.currency})`"><input v-model.number="creditForm.limit" type="number" min="0" /></FormField>
        <FormField label="Payment terms (days)"><input v-model.number="creditForm.terms" type="number" min="1" max="365" /></FormField>
        <button class="btn btn-primary btn-sm" :disabled="busy" @click="saveCredit">Save credit settings</button>
      </div>
      <h4 class="hist-title">Order history</h4>
      <DataTable
        :columns="[
          { key: 'code', label: 'Order' },
          { key: 'status', label: 'Status' },
          { key: 'paymentStatus', label: 'Payment' },
          { key: 'total', label: 'Total', align: 'right' },
          { key: 'created', label: 'Date' },
        ]"
        :rows="detail.orders" clickable empty-text="No orders yet."
        @row-click="(r) => openOrderId = r.id"
      >
        <template #cell-code="{ row }"><b>{{ row.code }}</b></template>
        <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
        <template #cell-paymentStatus="{ row }"><StatusBadge :status="row.paymentStatus" kind="payment" /></template>
        <template #cell-total="{ row }"><b class="mono">{{ money(row.totalCents, session.currency) }}</b></template>
        <template #cell-created="{ row }">{{ dateOnly(row.createdAt) }}</template>
      </DataTable>
    </Modal>

    <OrderDetailModal v-if="openOrderId" :order-id="openOrderId" @close="openOrderId = null"
      @changed="() => { load(); detail && openDetail(detail); }" />
  </div>
</template>

<style scoped>
.cust { display: flex; align-items: center; gap: 9px; }
.hist-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin-bottom: 8px; }
.credit-settings { display: grid; grid-template-columns: 1.5fr 1fr 1fr auto; gap: 10px; align-items: end; padding: 10px; margin-bottom: 12px; border: 1px solid var(--line); border-radius: 10px; background: #f7faf9; }
.credit-settings > label { display: flex; align-items: center; gap: 7px; font-size: 11px; padding-bottom: 8px; }
.credit-settings > label input { width: auto; }
@media (max-width: 760px) { .credit-settings { grid-template-columns: 1fr 1fr; } .credit-settings > label { grid-column: 1 / -1; } }
</style>
