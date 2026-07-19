<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { money, ORDER_STATUS_LABELS } from '../utils/format.js';
import StatusBadge from '../components/StatusBadge.vue';
import OrderDetailModal from '../components/OrderDetailModal.vue';
import Skeleton from '../components/Skeleton.vue';
import EmptyState from '../components/EmptyState.vue';
import CollectModal from '../components/CollectModal.vue';
import AppIcon from '../components/AppIcon.vue';

const session = useSession();
const toast = useToast();
const orders = ref(null); // null = first load (skeleton)
const q = ref('');
const showClosed = ref(true); // settled/closed orders are visible by default
const openOrderId = ref(null);
const busyId = ref(null);
const collectingOrderId = ref(null);

const STAGES = ['received', 'washing', 'ironing', 'ready', 'delivered'];

async function load() {
  try {
    orders.value = await api.get(showClosed.value ? '/orders' : '/orders?status=open');
  } catch (e) { toast.error(e.message); }
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

const byStage = computed(() =>
  STAGES.map((s) => ({ stage: s, cards: filtered.value.filter((o) => o.status === s) })));

// exact services on the order, one chip each ("Wash & Fold (per kg) · 7 kg")
const services = (o) => (o.itemsDetail || o.itemSummary || '').split('|').filter(Boolean);

async function advance(order) {
  if (order.status === 'ready') {
    collectingOrderId.value = order.id;
    return;
  }
  busyId.value = order.id;
  try {
    const updated = await api.post(`/orders/${order.id}/advance`);
    if (updated.status === 'ready') toast.success(`SMS sent to ${order.customerName}: “Order ${order.code} is ready for pickup”${order.paidCents < order.totalCents ? ' + payment reminder' : ''}`);
    else if (updated.status === 'delivered') toast.success(`${order.code} closed — ${money(order.totalCents, session.currency)} recognized as revenue in the P&L`);
    await load();
  } catch (e) { toast.error(e.message); }
  finally { busyId.value = null; }
}

</script>

<template>
  <div>
    <div class="section-head">
      <div>
        <h2>Orders Pipeline</h2>
        <p>Tap ▶ to advance an order. Customers are notified automatically at “Ready”.</p>
      </div>
      <div class="head-actions">
        <input v-model="q" type="search" placeholder="Search code, name, phone…" style="width: 220px;" />
        <button class="btn btn-ghost" @click="showClosed = !showClosed; load()">
          {{ showClosed ? 'Hide closed' : 'Show closed' }}
        </button>
      </div>
    </div>

    <Skeleton v-if="!orders" variant="kanban" :count="5" />
    <div v-else class="kanban">
      <div v-for="col in byStage" :key="col.stage" class="kcol">
        <h4>{{ ORDER_STATUS_LABELS[col.stage] }}<span>{{ col.cards.length }}</span></h4>
        <div v-for="c in col.cards" :key="c.id" class="kcard" @click="openOrderId = c.id">
          <div class="khead">
            <span class="ktag"><AppIcon name="tag" :size="11" /> {{ c.code }}</span>
            <b class="kprice">{{ money(c.totalCents, session.currency) }}</b>
          </div>
          <div class="meta">{{ c.customerName }}</div>
          <div class="kservices">
            <span v-for="s in services(c)" :key="s" class="addon-chip">{{ s }}</span>
          </div>
          <div class="kfoot">
            <StatusBadge :status="c.paymentStatus" kind="payment" />
            <StatusBadge v-if="c.express" status="generic" label="EXPRESS" />
            <button
              v-if="col.stage !== 'delivered' && session.can('orders.advance')"
              class="btn btn-primary btn-sm" :disabled="busyId === c.id"
              @click.stop="advance(c)"
            >▶ {{ ORDER_STATUS_LABELS[STAGES[STAGES.indexOf(col.stage) + 1]] }}</button>
            <StatusBadge v-else-if="col.stage === 'delivered'" status="delivered" label="closed" />
          </div>
        </div>
      </div>
    </div>
    <EmptyState v-if="orders && !filtered.length" icon="orders" title="No orders on the board"
      hint="Create your first order from the New Order screen." />

    <OrderDetailModal v-if="openOrderId" :order-id="openOrderId" @close="openOrderId = null" @changed="load" />
    <CollectModal v-if="collectingOrderId" :order-id="collectingOrderId" @close="collectingOrderId = null"
      @collected="() => { collectingOrderId = null; load(); }" />
  </div>
</template>

<style scoped>
.khead { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.ktag {
  display: inline-flex; align-items: center; gap: 4px; background: var(--side); color: #7ed7c9;
  border-radius: 6px; padding: 2px 7px; font-weight: 800; font-size: 11px; letter-spacing: 0.04em;
}
.kprice { font-size: 12px; color: var(--brand-dark); }
.kservices { display: flex; flex-wrap: wrap; margin-top: 3px; }
.kfoot { display: flex; gap: 6px; align-items: center; margin-top: 7px; flex-wrap: wrap; }
</style>
