<script setup>
import { computed, ref, onMounted, watch } from 'vue';
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
import Tabs from '../components/Tabs.vue';
import BaseButton from '../components/BaseButton.vue';
import ToggleSwitch from '../components/ToggleSwitch.vue';


const session = useSession();
const toast = useToast();
const custPage = ref(null); // { rows, total, limit, offset } — null = loading
const q = ref('');
const CUST_LIMIT = 10;
const addOpen = ref(false);
const addForm = ref({ name: '', phone: '', notes: '' });
const detail = ref(null);
const detailTab = ref('profile');
const orderPageBusy = ref(false);
const openOrderId = ref(null);
const busy = ref(false);
const creditForm = ref({ enabled: false, limit: 0, terms: 30 });
const ORDER_LIMIT = 10;

const detailTabs = computed(() => [
  { key: 'profile', label: 'Profile', icon: 'user' },
  ...(session.can('finance.manage') ? [{ key: 'credit', label: 'Credit', icon: 'shield' }] : []),
  { key: 'orders', label: 'Orders', icon: 'orders', count: detail.value?.orderPage?.total || 0 },
]);

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
    toast.success('Customer created');
    await load();
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}

async function openDetail(row, nextOffset = 0, reset = true) {
  try {
    detail.value = await api.get(`/customers/${row.id}?limit=${ORDER_LIMIT}&offset=${nextOffset}`);
    if (reset) {
      detailTab.value = 'profile';
      creditForm.value = { enabled: !!detail.value.creditEnabled, limit: detail.value.creditLimitCents / 100, terms: detail.value.creditTermsDays };
    }
  }
  catch (e) { toast.error(e.message); }
}

async function loadOrderPage(nextOffset) {
  orderPageBusy.value = true;
  try { await openDetail(detail.value, nextOffset, false); }
  finally { orderPageBusy.value = false; }
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
    await openDetail(detail.value, detail.value.orderPage?.offset || 0, false);
    await load();
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'orderCount', label: 'Orders', align: 'right' },
  { key: 'ltv', label: 'Lifetime value', align: 'right' },
  { key: 'last', label: 'Last order' },
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

    <Modal v-if="addOpen" title="New customer" subtitle="Add contact details now; preferences can be updated later." @close="addOpen = false">
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

    <Modal v-if="detail" :title="detail.name" :subtitle="`${detail.phone} · customer since ${dateOnly(detail.createdAt)}`" size="workspace" @close="detail = null">
      <div class="customer-summary">
        <Avatar :name="detail.name" :size="46" />
        <div><b>{{ detail.name }}</b><small>{{ detail.phone }}</small></div>
        <StatusBadge v-if="detail.creditEnabled" status="active" kind="generic" label="Credit enabled" />
      </div>

      <Tabs v-model="detailTab" :tabs="detailTabs" />

      <section v-if="detailTab === 'profile'" class="profile-grid">
        <div class="profile-card"><span class="profile-icon"><AppIcon name="phone" :size="17" /></span><div><small>Phone number</small><b>{{ detail.phone }}</b></div></div>
        <div class="profile-card"><span class="profile-icon"><AppIcon name="calendar" :size="17" /></span><div><small>Customer since</small><b>{{ dateOnly(detail.createdAt) }}</b></div></div>
        <div class="profile-card notes-card"><span class="profile-icon"><AppIcon name="edit" :size="17" /></span><div><small>Customer notes</small><b>{{ detail.notes || 'No notes recorded' }}</b></div></div>
      </section>

      <section v-else-if="detailTab === 'credit'" class="credit-workspace">
        <div class="credit-intro"><span class="credit-icon"><AppIcon name="shield" :size="20" /></span><div><b>Customer credit</b><p>Allow collection before full payment, within a controlled limit and payment term.</p></div><ToggleSwitch v-model="creditForm.enabled" /></div>
        <div class="credit-fields">
          <FormField :label="`Credit limit (${session.currency})`" hint="Maximum outstanding balance allowed"><input v-model.number="creditForm.limit" type="number" min="0" /></FormField>
          <FormField label="Payment terms (days)" hint="Number of days before payment is due"><input v-model.number="creditForm.terms" type="number" min="1" max="365" /></FormField>
        </div>
        <p class="audit-note"><AppIcon name="history" :size="13" /> Changes are written to the audit log.</p>
      </section>

      <section v-else class="orders-workspace">
        <div class="workspace-title"><div><h4>Order history</h4><p>Select an order to view services, payments, and activity.</p></div><span>{{ detail.orderPage.total }} total</span></div>
        <DataTable
          :columns="[
            { key: 'code', label: 'Order' },
            { key: 'status', label: 'Status' },
            { key: 'paymentStatus', label: 'Payment' },
            { key: 'total', label: 'Total', align: 'right' },
            { key: 'created', label: 'Date' },
          ]"
          :page="orderPageBusy ? null : detail.orderPage" compact clickable empty-text="No orders yet."
          @page="loadOrderPage" @row-click="(r) => openOrderId = r.id"
        >
          <template #cell-code="{ row }"><b>{{ row.code }}</b></template>
          <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
          <template #cell-paymentStatus="{ row }"><StatusBadge :status="row.paymentStatus" kind="payment" /></template>
          <template #cell-total="{ row }"><b class="mono">{{ money(row.totalCents, session.currency) }}</b></template>
          <template #cell-created="{ row }">{{ dateOnly(row.createdAt) }}</template>
        </DataTable>
      </section>

      <template #footer>
        <BaseButton variant="ghost" :disabled="busy" @click="detail = null">Close</BaseButton>
        <BaseButton v-if="detailTab === 'credit' && session.can('finance.manage')" icon="shield" :loading="busy" @click="saveCredit">Save credit settings</BaseButton>
      </template>
    </Modal>

    <OrderDetailModal v-if="openOrderId" :order-id="openOrderId" @close="openOrderId = null"
      @changed="() => { load(); detail && openDetail(detail, detail.orderPage?.offset || 0, false); }" />
  </div>
</template>

<style scoped>
.cust { display: flex; align-items: center; gap: 9px; }
.customer-summary { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.customer-summary > div { flex: 1; min-width: 0; }.customer-summary b, .customer-summary small { display: block; }.customer-summary b { font: 700 14px var(--font-ui); }.customer-summary small { color: var(--muted); font-size: 10.5px; }
.profile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.profile-card { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-subtle); }
.profile-card small, .profile-card b { display: block; }.profile-card small { color: var(--muted); font-size: 9.5px; }.profile-card b { font-size: 12px; }
.profile-icon, .credit-icon { display: grid; place-items: center; flex: 0 0 auto; width: 34px; height: 34px; border-radius: var(--radius-sm); color: var(--brand); background: var(--brand-light); }
.notes-card { grid-column: 1 / -1; align-items: flex-start; }.notes-card b { font-weight: 500; }
.credit-workspace { max-width: 680px; }
.credit-intro { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-subtle); }
.credit-intro > div:nth-child(2) { flex: 1; }.credit-intro b { font-size: 12.5px; }.credit-intro p { color: var(--muted); font-size: 10.5px; }
.credit-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.audit-note { display: flex; align-items: center; gap: 5px; margin-top: 10px; color: var(--muted); font-size: 10px; }
.workspace-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.workspace-title h4 { font: 700 12.5px var(--font-ui); }.workspace-title p { color: var(--muted); font-size: 10px; }.workspace-title > span { padding: 3px 8px; border-radius: var(--radius-pill); background: var(--brand-light); color: var(--brand-dark); font-size: 9.5px; font-weight: 700; }
@media (max-width: 640px) {
  .profile-grid, .credit-fields { grid-template-columns: 1fr; }
  .notes-card { grid-column: auto; }
  .customer-summary { align-items: flex-start; flex-wrap: wrap; }
}
</style>
