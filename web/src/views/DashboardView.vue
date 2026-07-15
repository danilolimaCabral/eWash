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

const session = useSession();
const router = useRouter();
const toast = useToast();
// each panel has its own endpoint + loading state so skeletons appear
// independently and one slow query never blanks the whole screen
const kpis = ref(null);
const activeOrders = ref(null);
const notifs = ref(null);
const filter = ref('all');
const openOrderId = ref(null);

const fetchPanel = (target, path) =>
  api.get(path).then((r) => { target.value = r; }).catch((e) => toast.error(e.message));

function load() {
  return Promise.all([
    fetchPanel(kpis, '/dashboard/kpis'),
    fetchPanel(activeOrders, '/dashboard/active-orders'),
    fetchPanel(notifs, '/dashboard/notifications'),
  ]);
}
onMounted(load);

const filters = computed(() => {
  const orders = activeOrders.value || [];
  const count = (s) => orders.filter((o) => o.status === s).length;
  return [
    { key: 'all', label: 'All', n: orders.length },
    { key: 'received', label: 'Received', n: count('received') },
    { key: 'washing', label: 'Washing', n: count('washing') },
    { key: 'ironing', label: 'Ironing', n: count('ironing') },
    { key: 'ready', label: 'Ready', n: count('ready') },
  ];
});

const visibleOrders = computed(() => {
  const orders = activeOrders.value || [];
  return filter.value === 'all' ? orders : orders.filter((o) => o.status === filter.value);
});

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
      <Panel flush title="Active orders" :subtitle="`${activeOrders?.length ?? '…'} orders currently in the shop`">
        <template #actions>
          <button class="text-btn" @click="router.push({ name: 'orders' })">View pipeline →</button>
        </template>
        <div class="ftabs">
          <button v-for="f in filters" :key="f.key" :class="{ active: filter === f.key }" @click="filter = f.key">
            {{ f.label }} <span>{{ f.n }}</span>
          </button>
        </div>
        <Skeleton v-if="!activeOrders" variant="table" :count="4" />
        <DataTable v-else :columns="columns" :rows="visibleOrders" clickable empty-text="No active orders — enjoy the calm."
          @row-click="(r) => openOrderId = r.id">
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

      <Panel title="Recent notifications" subtitle="SMS sent to customers">
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
.notif p { font-size: 11.5px; margin: 5px 0 2px; color: #45535a; }
@media (max-width: 1100px) { .dash-grid { grid-template-columns: 1fr; } }
@media (max-width: 640px) {
  .ftabs { padding: 0 14px; }
  .dash-grid { gap: 0; }
}
</style>
