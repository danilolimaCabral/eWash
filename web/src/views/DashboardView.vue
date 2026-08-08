<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { money, timeAgo } from '../utils/format.js';
import KpiCard from '../components/KpiCard.vue';
import Panel from '../components/Panel.vue';
import DataTable from '../components/DataTable.vue';
import StatusBadge from '../components/StatusBadge.vue';
import Avatar from '../components/Avatar.vue';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import Skeleton from '../components/Skeleton.vue';
import OrderDetailModal from '../components/OrderDetailModal.vue';
import Modal from '../components/Modal.vue';
import Pagination from '../components/Pagination.vue';

const session = useSession();
const router = useRouter();
const toast = useToast();
// each panel has its own endpoint + loading state so skeletons appear
// independently and one slow query never blanks the whole screen
const kpis = ref(null);
const ordersPage = ref(null); // { rows, total, limit, offset, counts }
const notifs = ref(null); // the 5 most recent, for the side panel
const filter = ref('all');
const openOrderId = ref(null);
const ORDERS_LIMIT = 10;

const fetchPanel = (target, path) =>
  api.get(path).then((r) => { target.value = r; }).catch((e) => toast.error(e.message));

async function loadOrders(nextOffset = 0) {
  try {
    const params = new URLSearchParams({ limit: ORDERS_LIMIT, offset: nextOffset });
    if (filter.value !== 'all') params.set('status', filter.value);
    ordersPage.value = await api.get(`/dashboard/active-orders?${params}`);
  } catch (e) { toast.error(e.message); }
}

function load() {
  return Promise.all([
    fetchPanel(kpis, '/dashboard/kpis'),
    loadOrders(ordersPage.value?.offset ?? 0),
    fetchPanel(notifs, '/dashboard/notifications'),
  ]);
}
onMounted(load);

function setFilter(key) {
  filter.value = key;
  loadOrders(0);
}

const filters = computed(() => {
  const counts = ordersPage.value?.counts || {};
  const n = (s) => counts[s] || 0;
  return [
    { key: 'all', label: 'All', n: n('received') + n('washing') + n('ironing') + n('ready') + n('delivered') },
    { key: 'received', label: 'Received', n: n('received') },
    { key: 'washing', label: 'Washing', n: n('washing') },
    { key: 'ironing', label: 'Ironing', n: n('ironing') },
    { key: 'ready', label: 'Ready', n: n('ready') },
    { key: 'delivered', label: 'Done', n: n('delivered') },
  ];
});

// full notification history, loaded lazily when "View all" is opened
const notifAllOpen = ref(false);
const notifPage = ref(null); // { rows, total, limit, offset }
const NOTIF_LIMIT = 10;
async function loadAllNotifs(nextOffset = 0) {
  try { notifPage.value = await api.get(`/dashboard/notifications?limit=${NOTIF_LIMIT}&offset=${nextOffset}`); }
  catch (e) { toast.error(e.message); }
}
function openAllNotifs() {
  notifAllOpen.value = true;
  if (!notifPage.value) loadAllNotifs(0);
}

const columns = [
  { key: 'code', label: 'Order' },
  { key: 'customer', label: 'Customer' },
  { key: 'service', label: 'Service' },
  { key: 'status', label: 'Status' },
  { key: 'total', label: 'Total', align: 'right' },
];
</script>

<template>
  <div>
    <div class="section-head">
      <div>
        <h2>Today's overview</h2>
        <p>Here's what's happening at {{ session.tenant?.name }}.</p>
      </div>
      <div class="head-actions">
        <button v-if="session.can('orders.create')" class="btn btn-primary" @click="router.push({ name: 'new-order' })">
          <AppIcon name="plus" :size="15" /> New order
        </button>
      </div>
    </div>

    <div class="cards">
      <template v-if="kpis">
        <KpiCard label="Today's orders" :value="String(kpis.todayOrders)" icon="orders" icon-tone="blue"
          :delta="kpis.dueSoon ? `${kpis.dueSoon} due soon` : 'on track'" :delta-kind="kpis.dueSoon ? 'down' : 'up'"
          :bars="[24, 45, 38, 64, 82, 100]" />
        <KpiCard label="Today's billed" :value="money(kpis.todayRevenueCents, session.currency)" icon="finance" icon-tone="green"
          :delta="`${money(kpis.todayCollectedCents, session.currency)} collected`" delta-kind="up"
          :bars="[28, 52, 43, 68, 78, 96]" />
        <KpiCard label="In progress" :value="String(kpis.inProgress)" icon="clock" icon-tone="violet"
          :delta="kpis.unpaidReady ? `${kpis.unpaidReady} ready & unpaid` : ''"
          :progress="kpis.inProgress ? Math.min(100, Math.round((kpis.ready / kpis.inProgress) * 100)) : 0" />
        <KpiCard label="Ready to collect" :value="String(kpis.ready)" icon="checkCircle" icon-tone="orange"
          :delta="kpis.readyOverdue ? `${kpis.readyOverdue} waiting 48h+` : 'none overdue'"
          :delta-kind="kpis.readyOverdue ? 'down' : 'up'" :bars="[88, 72, 66, 48, 42, 30]" />
      </template>
      <Skeleton v-else variant="kpi" :count="4" />
    </div>

    <div class="dash-grid">
      <Panel flush title="Orders" :subtitle="`${ordersPage?.total ?? '…'} orders — active and completed`">
        <template #actions>
          <button class="text-btn" @click="router.push({ name: 'orders' })">View pipeline →</button>
        </template>
        <div class="ftabs">
          <button v-for="f in filters" :key="f.key" :class="{ active: filter === f.key }" @click="setFilter(f.key)">
            {{ f.label }} <span>{{ f.n }}</span>
          </button>
        </div>
        <DataTable :columns="columns" :page="ordersPage" clickable compact
          empty-text="No orders here yet." @page="loadOrders" @row-click="(r) => openOrderId = r.id">
          <template #cell-code="{ row }">
            <strong>{{ row.code }}</strong>
            <small class="muted block">{{ row.itemCount }} item{{ row.itemCount === 1 ? '' : 's' }}<template v-if="row.kgTotal"> · {{ row.kgTotal }} kg</template></small>
          </template>
          <template #cell-customer="{ row }">
            <span class="cust"><Avatar :name="row.customerName" /> <span><b>{{ row.customerName }}</b><small class="muted block">{{ row.customerPhone }}</small></span></span>
          </template>
          <template #cell-service="{ row }">{{ row.itemSummary }}</template>
          <template #cell-status="{ row }">
            <StatusBadge :status="row.status" />
            <StatusBadge v-if="row.paymentStatus !== 'paid'" :status="row.paymentStatus" kind="payment" />
          </template>
          <template #cell-total="{ row }"><b class="mono">{{ money(row.totalCents, session.currency) }}</b></template>
        </DataTable>
      </Panel>

      <Panel title="Recent notifications" subtitle="The last 5 SMS sent to customers">
        <template #actions>
          <button class="text-btn" @click="openAllNotifs">View all →</button>
        </template>
        <Skeleton v-if="!notifs" variant="list" :count="3" />
        <div v-else-if="notifs.length" class="notif-list">
          <div v-for="n in notifs" :key="n.id" class="notif">
            <StatusBadge :status="n.status" kind="generic" :label="n.templateKey.replaceAll('_', ' ')" />
            <p>{{ n.message }}</p>
            <small class="muted">{{ n.toPhone }} · {{ timeAgo(n.sentAt) }}</small>
          </div>
        </div>
        <EmptyState v-else icon="bell" title="No notifications yet" hint="Quotes and ready-alerts appear here as they are sent." />
      </Panel>
    </div>

    <Modal v-if="notifAllOpen" title="All notifications" subtitle="Recent customer and delivery messages sent by the business" wide @close="notifAllOpen = false">
      <Skeleton v-if="!notifPage" variant="list" :count="5" />
      <template v-else>
        <div v-if="notifPage.rows.length" class="notif-list">
          <div v-for="n in notifPage.rows" :key="n.id" class="notif all-row">
            <div class="all-head">
              <StatusBadge :status="n.status" kind="generic" :label="n.templateKey.replaceAll('_', ' ')" />
              <small class="muted">{{ n.toPhone }} · {{ timeAgo(n.sentAt) }}</small>
            </div>
            <p>{{ n.message }}</p>
          </div>
        </div>
        <EmptyState v-else icon="bell" title="No notifications yet" hint="Quotes and ready-alerts appear here as they are sent." />
        <Pagination :total="notifPage.total" :limit="NOTIF_LIMIT" :offset="notifPage.offset" @change="loadAllNotifs" />
      </template>
    </Modal>

    <OrderDetailModal v-if="openOrderId" :order-id="openOrderId" @close="openOrderId = null" @changed="load" />
  </div>
</template>

<style scoped>
.dash-grid { display: grid; grid-template-columns: 1fr 320px; gap: 14px; align-items: start; }
.dash-grid > * { min-width: 0; } /* grid items must shrink below content width on small screens */
.text-btn { border: none; background: none; color: var(--brand); font-size: 11.5px; font-weight: 700; cursor: pointer; font-family: inherit; padding: 0; }
.ftabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 4px; overflow-x: auto; scrollbar-width: none; }
.ftabs::-webkit-scrollbar { display: none; }
.ftabs { padding: 0 18px; }
.ftabs button {
  border: none; background: none; padding: 9px 12px; font-size: 12px; font-weight: 600; color: var(--muted);
  cursor: pointer; border-bottom: 2px solid transparent; font-family: inherit; display: flex; gap: 6px; align-items: center; white-space: nowrap;
}
.ftabs button span { background: #eef2f1; border-radius: 8px; padding: 1px 7px; font-size: 10px; }
.ftabs button.active { color: var(--ink); border-bottom-color: var(--brand); }
.ftabs button.active span { background: var(--brand-light); color: var(--brand-dark); }
.cust { display: flex; align-items: center; gap: 9px; }
.block { display: block; }
.notif-list { display: flex; flex-direction: column; gap: 12px; }
/* SMS bodies can contain long unbroken URLs (rider confirm links) — allow
   them to break anywhere so they never overflow the panel */
.notif p { font-size: 11.5px; margin: 5px 0 2px; color: #45535a; overflow-wrap: anywhere; }
.all-row { border-bottom: 1px solid #f0f4f3; padding-bottom: 10px; }
.all-row:last-child { border-bottom: 0; }
.all-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
@media (max-width: 1100px) { .dash-grid { grid-template-columns: 1fr; } }
@media (max-width: 640px) {
  .ftabs { padding: 0 14px; }
  .dash-grid { gap: 0; }
}
</style>
