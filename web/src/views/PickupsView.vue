<script setup>
// Pickups: the ready-for-collection queue plus the full pickup/delivery
// history. Any row opens the shared OrderDetailModal (order details, pickup
// record, payments, status history).
import { ref, onMounted, computed, watch } from 'vue';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { money, timeAgo, dateTime } from '../utils/format.js';
import Panel from '../components/Panel.vue';
import Tabs from '../components/Tabs.vue';
import DataTable from '../components/DataTable.vue';
import Avatar from '../components/Avatar.vue';
import StatusBadge from '../components/StatusBadge.vue';
import EmptyState from '../components/EmptyState.vue';
import CollectModal from '../components/CollectModal.vue';
import OrderDetailModal from '../components/OrderDetailModal.vue';

const session = useSession();
const toast = useToast();
const tab = ref('ready'); // ready | history
const q = ref('');
const ready = ref(null); // ready queue page — { rows, total, limit, offset }
const READY_LIMIT = 10;
const history = ref(null); // { rows, total, limit, offset }
const historyOffset = ref(0);
const HISTORY_LIMIT = 10;
const collecting = ref(null); // order row being collected
const viewing = ref(null); // order id open in the detail modal

async function loadReady(nextOffset = 0) {
  try {
    const params = new URLSearchParams({ status: 'ready', limit: READY_LIMIT, offset: nextOffset });
    if (q.value.trim()) params.set('q', q.value.trim());
    ready.value = await api.get(`/orders?${params}`);
  } catch (e) { toast.error(e.message); }
}
async function loadHistory(nextOffset = 0) {
  historyOffset.value = nextOffset;
  try {
    const params = new URLSearchParams({ status: 'delivered', limit: HISTORY_LIMIT, offset: nextOffset });
    if (q.value.trim()) params.set('q', q.value.trim());
    history.value = await api.get(`/orders?${params}`);
  } catch (e) { toast.error(e.message); }
}
function reload() {
  loadReady();
  loadHistory(tab.value === 'history' ? historyOffset.value : 0);
}
onMounted(reload);

// search is server-side on both tabs — debounce keystrokes into one request
let qTimer;
watch(q, () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => (tab.value === 'history' ? loadHistory(0) : loadReady(0)), 300);
});
watch(tab, () => { if (tab.value === 'history') loadHistory(0); });

const tabs = computed(() => [
  { key: 'ready', label: 'Ready for pickup', icon: 'bell', count: ready.value?.total ?? undefined },
  { key: 'history', label: 'Pickup history', icon: 'history', count: history.value?.total ?? undefined },
]);

const readyColumns = [
  { key: 'code', label: 'Tag' },
  { key: 'customer', label: 'Customer' },
  { key: 'items', label: 'Items' },
  { key: 'balance', label: 'Balance', align: 'right' },
  { key: 'waiting', label: 'Ready since' },
  { key: 'action', label: '', align: 'right' },
];
const historyColumns = [
  { key: 'code', label: 'Tag' },
  { key: 'customer', label: 'Customer' },
  { key: 'items', label: 'Items' },
  { key: 'total', label: 'Total / paid', align: 'right' },
  { key: 'handoff', label: 'Handed over' },
  { key: 'action', label: '', align: 'right' },
];
</script>

<template>
  <div>
    <div class="section-head">
      <div>
        <h2>Pickups</h2>
        <p>Cleaned &amp; ready orders awaiting collection, and everything already handed over. Open any order for its full record.</p>
      </div>
      <div class="head-actions">
        <input v-model="q" type="search" placeholder="Search tag, name, phone…" style="width: 220px;" />
      </div>
    </div>

    <Tabs v-model="tab" :tabs="tabs" />

    <Panel v-if="tab === 'ready'">
      <template v-if="!ready || ready.rows.length">
        <DataTable :columns="readyColumns" :page="ready" clickable @page="loadReady" @row-click="(row) => viewing = row.id">
          <template #cell-code="{ row }"><b class="tag">{{ row.code }}</b></template>
          <template #cell-customer="{ row }">
            <span class="cust"><Avatar :name="row.customerName" />
              <span><b>{{ row.customerName }}</b><small class="muted block">{{ row.customerPhone }}</small></span></span>
          </template>
          <template #cell-items="{ row }">{{ row.itemSummary }}</template>
          <template #cell-balance="{ row }">
            <b class="mono" :class="row.totalCents - row.paidCents > 0 ? 'text-red' : 'text-green'">
              {{ money(row.totalCents - row.paidCents, session.currency) }}
            </b>
            <StatusBadge v-if="row.paidCents >= row.totalCents" status="paid" kind="payment" />
          </template>
          <template #cell-waiting="{ row }">{{ timeAgo(row.createdAt) }}</template>
          <template #cell-action="{ row }">
            <button class="btn btn-green btn-sm" @click.stop="collecting = row">Collect &amp; pay</button>
          </template>
        </DataTable>
      </template>
      <EmptyState v-else icon="checkCircle" title="Nothing waiting for pickup"
        hint="Orders appear here when they reach the “Ready” stage on the pipeline." />
    </Panel>

    <Panel v-else>
      <template v-if="!history || history.rows.length">
        <DataTable :columns="historyColumns" :page="history" clickable @page="loadHistory" @row-click="(row) => viewing = row.id">
            <template #cell-code="{ row }"><b class="tag">{{ row.code }}</b></template>
            <template #cell-customer="{ row }">
              <span class="cust"><Avatar :name="row.customerName" />
                <span><b>{{ row.customerName }}</b><small class="muted block">{{ row.customerPhone }}</small></span></span>
            </template>
            <template #cell-items="{ row }">{{ row.itemSummary }}</template>
            <template #cell-total="{ row }">
              <b class="mono">{{ money(row.totalCents, session.currency) }}</b>
              <small class="block" :class="row.paidCents >= row.totalCents ? 'text-green' : 'text-red'">
                {{ row.paidCents >= row.totalCents ? 'paid in full' : `${money(row.paidCents, session.currency)} paid` }}
              </small>
            </template>
            <template #cell-handoff="{ row }">
              <span class="handoff-chip" :class="row.handoffType === 'delivery' ? 'delivery' : 'pickup'">
                {{ row.handoffType === 'delivery' ? 'Delivered' : 'Collected' }}
              </span>
              <small class="muted block">
                <template v-if="row.collectedByName">by {{ row.collectedByName }} · </template>{{ dateTime(row.collectedAt || row.closedAt) }}
              </small>
            </template>
          <template #cell-action="{ row }">
            <button class="btn btn-ghost btn-sm" @click.stop="viewing = row.id">View</button>
          </template>
        </DataTable>
      </template>
      <EmptyState v-else icon="history" title="No past pickups"
        :hint="q ? 'Nothing matches your search — try another tag, name or phone.' : 'Collected and delivered orders will build up here.'" />
    </Panel>

    <CollectModal v-if="collecting" :order-id="collecting.id" @close="collecting = null"
      @collected="() => { collecting = null; reload(); }" />
    <OrderDetailModal v-if="viewing" :order-id="viewing" @close="viewing = null" @changed="reload" />
  </div>
</template>

<style scoped>
.cust { display: flex; align-items: center; gap: 9px; }
.block { display: block; }
.tag { letter-spacing: 0.05em; color: var(--brand-dark); }
.handoff-chip {
  display: inline-block; padding: 2px 8px; border-radius: 999px;
  font-size: 10px; font-weight: 700; background: #e6f5ef; color: var(--green);
}
.handoff-chip.delivery { background: #eef0fb; color: var(--purple); }
</style>
