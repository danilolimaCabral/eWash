<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { money, timeAgo } from '../utils/format.js';
import Panel from '../components/Panel.vue';
import DataTable from '../components/DataTable.vue';
import Avatar from '../components/Avatar.vue';
import StatusBadge from '../components/StatusBadge.vue';
import Skeleton from '../components/Skeleton.vue';
import EmptyState from '../components/EmptyState.vue';
import CollectModal from '../components/CollectModal.vue';

const session = useSession();
const toast = useToast();
const orders = ref(null); // null = first load (skeleton)
const q = ref('');
const collecting = ref(null); // order row being collected

async function load() {
  try { orders.value = await api.get('/orders?status=ready'); }
  catch (e) { toast.error(e.message); }
}
onMounted(load);

const filtered = computed(() => {
  const query = q.value.trim().toLowerCase();
  const list = orders.value || [];
  if (!query) return list;
  return list.filter((o) =>
    o.code.toLowerCase().includes(query) ||
    o.customerName.toLowerCase().includes(query) ||
    (o.customerPhone || '').includes(query));
});

const columns = [
  { key: 'code', label: 'Tag' },
  { key: 'customer', label: 'Customer' },
  { key: 'items', label: 'Items' },
  { key: 'balance', label: 'Balance', align: 'right' },
  { key: 'waiting', label: 'Ready since' },
  { key: 'action', label: '', align: 'right' },
];
</script>

<template>
  <div>
    <div class="section-head">
      <div>
        <h2>Ready for pickup</h2>
        <p>Cleaned &amp; ready orders. Manual M-Pesa or cash payment is recorded here against the order tag.</p>
      </div>
      <div class="head-actions">
        <input v-model="q" type="search" placeholder="Search tag, name, phone…" style="width: 220px;" />
      </div>
    </div>

    <Panel>
      <Skeleton v-if="!orders" variant="table" :count="4" />
      <template v-else>
        <DataTable v-if="filtered.length" :columns="columns" :rows="filtered">
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
            <button class="btn btn-green btn-sm" @click="collecting = row">Collect &amp; pay</button>
          </template>
        </DataTable>
        <EmptyState v-else icon="checkCircle" title="Nothing waiting for pickup"
          hint="Orders appear here when they reach the “Ready” stage on the pipeline." />
      </template>
    </Panel>

    <CollectModal v-if="collecting" :order-id="collecting.id" @close="collecting = null"
      @collected="() => { collecting = null; load(); }" />
  </div>
</template>

<style scoped>
.cust { display: flex; align-items: center; gap: 9px; }
.block { display: block; }
.tag { letter-spacing: 0.05em; color: var(--brand-dark); }
</style>
