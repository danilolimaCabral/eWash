<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { money, dateTime } from '../utils/format.js';
import Modal from './Modal.vue';
import StatusBadge from './StatusBadge.vue';
import FormField from './FormField.vue';
import AppIcon from './AppIcon.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import CollectModal from './CollectModal.vue';
import Tabs from './Tabs.vue';
import BaseButton from './BaseButton.vue';
import AppSelect from './AppSelect.vue';
import EmptyState from './EmptyState.vue';
import Skeleton from './Skeleton.vue';

const props = defineProps({ orderId: { type: String, required: true } });
const emit = defineEmits(['close', 'changed']);

const session = useSession();
const toast = useToast();
const order = ref(null);
const busy = ref(false);
const payForm = ref({ open: false, method: 'mpesa_manual', amount: 0, mpesa_ref: '' });
const discountForm = ref({ open: false, amount: 0, reason: '' });
const handoffOpen = ref(false);
const activeTab = ref('overview');
const moreOpen = ref(false);

const NEXT = { received: 'washing', washing: 'ironing', ironing: 'ready', ready: 'delivered' };

async function load() {
  order.value = await api.get(`/orders/${props.orderId}`);
}
onMounted(load);

const canAdvance = computed(() => order.value && order.value.confirmedAt && NEXT[order.value.status] && session.can('orders.advance'));
const isOpen = computed(() => order.value && !['delivered', 'void'].includes(order.value.status));

async function run(fn, okMsg) {
  busy.value = true;
  try {
    await fn();
    await load();
    emit('changed');
    if (okMsg) toast.success(okMsg);
  } catch (e) {
    toast.error(e.message);
  } finally {
    busy.value = false;
  }
}

const advance = () => {
  if (NEXT[order.value.status] === 'delivered') {
    handoffOpen.value = true;
    return;
  }
  run(
    () => api.post(`/orders/${order.value.id}/advance`),
    `Moved to ${NEXT[order.value.status]}${NEXT[order.value.status] === 'ready' ? ' — customer notified by SMS' : ''}`
  );
};
const completeHandoff = () => run(async () => {
  handoffOpen.value = false;
}, `${order.value?.code} handed over and closed`);
const confirmQuote = () => run(() => api.post(`/orders/${order.value.id}/confirm`), 'Quote confirmed — price snapshot locked');
const voidOpen = ref(false);
const voidOrder = () => run(async () => {
  await api.post(`/orders/${order.value.id}/void`, { reason: 'voided from order view' });
  voidOpen.value = false;
}, 'Order voided');

function openPay() {
  discountForm.value.open = false;
  activeTab.value = 'payments';
  payForm.value = { open: true, method: 'mpesa_manual', amount: order.value.balanceCents / 100, mpesa_ref: '' };
}
function openDiscount() {
  payForm.value.open = false;
  activeTab.value = 'overview';
  discountForm.value = { open: true, amount: 0, reason: '' };
}
const takePayment = () => run(async () => {
  const updated = await api.post(`/orders/${order.value.id}/payments`, {
    method: payForm.value.method,
    amount_cents: Math.round(payForm.value.amount * 100),
    mpesa_ref: payForm.value.mpesa_ref || undefined,
  });
  payForm.value.open = false;
  order.value = updated;
}, payForm.value.method === 'cash' ? 'Cash payment recorded — receipt SMS sent' : undefined);

const simulateCallback = (paymentId) => run(
  () => api.post(`/payments/${paymentId}/simulate`),
  'M-Pesa payment confirmed — receipt SMS sent'
);
const refundingId = ref(null);
const refund = () => run(async () => {
  await api.post(`/payments/${refundingId.value}/refund`, { reason: 'refund from order view' });
  refundingId.value = null;
}, 'Payment refunded');

const applyDiscount = () => run(async () => {
  await api.post(`/orders/${order.value.id}/discount`, {
    amount_cents: Math.round(discountForm.value.amount * 100),
    reason: discountForm.value.reason,
  });
  discountForm.value.open = false;
}, 'Discount applied — audit-logged');
</script>

<template>
  <Modal :title="order ? `Order ${order.code}` : 'Order details'"
    :subtitle="order ? `${order.customer?.name || 'Customer'} · created ${dateTime(order.createdAt)}` : 'Loading order information'"
    size="workspace" @close="$emit('close')">
    <template #header-extra>
      <template v-if="order">
        <StatusBadge :status="order.status" />
        <StatusBadge :status="order.paymentStatus" kind="payment" />
        <StatusBadge v-if="order.express" status="generic" label="EXPRESS" />
      </template>
    </template>

    <div v-if="order" class="detail">
      <div class="order-summary">
        <div class="customer-summary">
          <span class="summary-icon"><AppIcon name="user" :size="18" /></span>
          <span><b>{{ order.customer?.name }}</b><small>{{ order.customer?.phone || 'No phone number' }}</small></span>
        </div>
        <div class="summary-stat"><small>Order total</small><b>{{ money(order.totalCents, session.currency) }}</b></div>
        <div class="summary-stat balance"><small>Balance due</small><b :class="order.balanceCents > 0 ? 'text-red' : 'text-green'">{{ money(order.balanceCents, session.currency) }}</b></div>
      </div>

      <Tabs v-model="activeTab" :tabs="[
        { key: 'overview', label: 'Overview', icon: 'orders', count: order.items.length },
        { key: 'payments', label: 'Payments', icon: 'cash', count: order.payments.length },
        { key: 'activity', label: 'Activity', icon: 'history', count: order.history.length },
      ]" />

      <div v-if="activeTab === 'overview'" class="overview-grid">
        <section class="detail-section">
          <div class="section-title"><div><h4>Services</h4><p>Price snapshot for this order</p></div></div>
          <div class="lineitem" v-for="item in order.items" :key="item.id">
            <div class="li-head"><span>{{ item.serviceName }}<template v-if="item.variantLabel"> · {{ item.variantLabel }}</template></span><span>{{ money(item.lineTotalCents, session.currency) }}</span></div>
            <div class="li-sub">{{ item.qty }} {{ item.unit }} × {{ money(item.unitPriceCents, session.currency) }}<b v-if="item.minApplied"> · minimum applied</b></div>
            <div class="chips">
              <span v-for="tag in item.tags" :key="tag.id" class="addon-chip"><AppIcon name="tag" :size="11" />{{ tag.tagCode }}</span>
              <span v-for="a in item.addons" :key="a.id" class="addon-chip">{{ a.addonName }} · {{ a.qty }} {{ a.unit }} · {{ money(a.totalCents, session.currency) }}</span>
            </div>
          </div>
        </section>

        <aside class="pricing-card">
          <div class="section-title"><div><h4>Order summary</h4><p>{{ order.confirmedAt ? 'Quote confirmed and price locked' : 'Quote awaiting confirmation' }}</p></div><AppIcon :name="order.confirmedAt ? 'shield' : 'alert'" :size="17" /></div>
          <div class="price-row"><span>Subtotal</span><span>{{ money(order.subtotalCents, session.currency) }}</span></div>
          <div v-if="order.expressCents" class="price-row"><span>Express surcharge</span><span>{{ money(order.expressCents, session.currency) }}</span></div>
          <div v-if="order.discountCents" class="price-row text-red"><span>Discount</span><span>−{{ money(order.discountCents, session.currency) }}</span></div>
          <div class="price-row total"><span>Total</span><span>{{ money(order.totalCents, session.currency) }}</span></div>
          <div class="price-row paid"><span>Paid</span><span>{{ money(order.paidCents, session.currency) }}</span></div>

          <div v-if="discountForm.open" class="focused-form">
            <h4>Apply discount</h4>
            <FormField :label="`Amount (${session.currency})`"><input v-model.number="discountForm.amount" type="number" min="1" /></FormField>
            <FormField label="Reason (audit log)"><input v-model="discountForm.reason" type="text" placeholder="e.g. loyal customer" /></FormField>
            <div class="form-actions"><BaseButton size="sm" :loading="busy" @click="applyDiscount">Apply discount</BaseButton><BaseButton variant="text" size="sm" @click="discountForm.open = false">Cancel</BaseButton></div>
          </div>

          <div v-if="isOpen && (session.can('orders.discount') || session.can('orders.void'))" class="more-actions">
            <button class="more-toggle" @click="moreOpen = !moreOpen"><span>More order actions</span><AppIcon name="chevronDown" :size="14" /></button>
            <div v-if="moreOpen" class="more-menu">
              <button v-if="session.can('orders.discount')" :disabled="busy" @click="openDiscount"><AppIcon name="edit" :size="14" /><span><b>Apply discount</b><small>Requires a reason and is audit-logged</small></span></button>
              <button v-if="session.can('orders.void')" class="danger-action" :disabled="busy" @click="voidOpen = true"><AppIcon name="trash" :size="14" /><span><b>Void order</b><small>Cancel and remove it from the pipeline</small></span></button>
            </div>
          </div>
        </aside>
      </div>

      <div v-else-if="activeTab === 'payments'" class="tab-surface">
        <div v-if="payForm.open" class="focused-form payment-form">
          <div class="section-title"><div><h4>Record payment</h4><p>Balance due: {{ money(order.balanceCents, session.currency) }}</p></div><button class="form-close" aria-label="Close payment form" @click="payForm.open = false"><AppIcon name="x" :size="13" /></button></div>
          <div class="payment-fields">
            <FormField label="Method"><AppSelect v-model="payForm.method"><option value="mpesa_manual">M-Pesa code (manual)</option><option value="cash">Cash</option><option value="mpesa_stk" disabled>M-Pesa STK push — Coming soon</option></AppSelect></FormField>
            <FormField :label="`Amount (${session.currency})`"><input v-model.number="payForm.amount" type="number" min="1" step="1" /></FormField>
            <FormField v-if="payForm.method === 'mpesa_manual'" label="M-Pesa code"><input v-model="payForm.mpesa_ref" type="text" placeholder="e.g. SGH61KXTOP" /></FormField>
          </div>
          <div class="form-actions"><BaseButton variant="green" icon="cash" :loading="busy" @click="takePayment">Record payment</BaseButton><BaseButton variant="ghost" @click="payForm.open = false">Cancel</BaseButton></div>
        </div>

        <div class="section-title"><div><h4>Payment history</h4><p>Every attempt and completed payment for this order</p></div></div>
        <EmptyState v-if="!order.payments.length" icon="cash" title="No payments recorded" hint="Record a payment when the customer pays toward this order." />
        <div v-for="p in order.payments" :key="p.id" class="payment-row">
            <StatusBadge :status="p.status" kind="generic" />
            <span class="pay-info">
              <b>{{ money(p.amountCents, session.currency) }}</b>
              <small class="muted block">
                {{ p.method === 'mpesa_manual' ? 'M-Pesa' : p.method.replace('_', ' ') }}<template v-if="p.mpesaRef"> · {{ p.mpesaRef }}</template> · {{ dateTime(p.at) }}
              </small>
            </span>
          <BaseButton v-if="p.status === 'pending' && p.method === 'mpesa_stk'" variant="ghost" size="sm" :disabled="busy" @click="simulateCallback(p.id)">Simulate callback</BaseButton>
          <BaseButton v-if="p.status === 'completed' && session.can('payments.refund')" variant="danger" size="sm" :disabled="busy" @click="refundingId = p.id">Refund</BaseButton>
        </div>
      </div>

      <div v-else class="tab-surface">
        <div v-if="order.collectedAt" class="handoff-record"><AppIcon :name="order.handoffType === 'delivery' ? 'send' : 'checkCircle'" :size="18" /><div><b>{{ order.handoffType === 'delivery' ? 'Taken for delivery' : 'Collected' }} by {{ order.collectedByName }}</b><small>{{ dateTime(order.collectedAt) }}</small></div></div>
        <div class="section-title"><div><h4>Status history</h4><p>The order's progress from creation to completion</p></div></div>
        <div class="timeline">
          <div v-for="h in order.history" :key="h.id" class="timeline-row"><span class="timeline-mark"><AppIcon name="check" :size="11" /></span><div><b>{{ h.toStatus }}</b><small>{{ h.fromStatus ? `Moved from ${h.fromStatus}` : 'Order created' }}</small></div><time>{{ dateTime(h.at) }}</time></div>
        </div>
      </div>
    </div>
    <div v-else class="loading-detail"><Skeleton variant="list" :count="4" /></div>

    <template v-if="order" #footer>
      <div class="footer-context"><b>{{ order.status }}</b><span>{{ order.balanceCents > 0 ? `${money(order.balanceCents, session.currency)} still due` : 'Fully paid' }}</span></div>
      <div class="footer-actions">
        <BaseButton variant="ghost" @click="$emit('close')">Close</BaseButton>
        <BaseButton v-if="!order.confirmedAt && isOpen" variant="ghost" icon="check" :loading="busy" @click="confirmQuote">Confirm quote</BaseButton>
        <BaseButton v-if="order.balanceCents > 0 && session.can('payments.receive')" variant="green" icon="cash" :loading="busy" @click="openPay">Take payment</BaseButton>
        <BaseButton v-if="canAdvance" icon="chevronRight" :loading="busy" @click="advance">Move to {{ NEXT[order.status] }}</BaseButton>
      </div>
    </template>
    <CollectModal v-if="handoffOpen && order" :order-id="order.id"
      @close="handoffOpen = false" @collected="completeHandoff" />
    <ConfirmDialog v-if="voidOpen" danger :busy="busy"
      :title="`Void order ${order?.code}?`"
      message="The order is cancelled and removed from the pipeline. This is written to the audit log."
      confirm-label="Void order"
      @confirm="voidOrder" @close="voidOpen = false" />
    <ConfirmDialog v-if="refundingId" danger :busy="busy"
      title="Refund this payment?"
      message="The amount is returned to the customer and the refund is written to the audit log."
      confirm-label="Refund payment"
      @confirm="refund" @close="refundingId = null" />
  </Modal>
</template>

<style scoped>
.order-summary { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; align-items: center; margin-bottom: 14px; }
.customer-summary { display: flex; align-items: center; gap: 9px; min-width: 0; }
.customer-summary b, .customer-summary small, .summary-stat b, .summary-stat small { display: block; }
.customer-summary small, .summary-stat small { color: var(--muted); font-size: 10px; }
.summary-icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; background: var(--brand-light); color: var(--brand); }
.summary-stat { min-width: 118px; padding: 7px 11px; border-left: 1px solid var(--line); text-align: right; }
.summary-stat b { font: 800 16px var(--font-ui); }
.overview-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(250px, .7fr); gap: 14px; align-items: start; }
.detail-section, .pricing-card, .tab-surface { min-width: 0; }
.section-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
.section-title h4 { font: 700 12.5px var(--font-ui); }
.section-title p { color: var(--muted); font-size: 10px; }
.pricing-card { position: sticky; top: 0; padding: 12px; border: 1px solid var(--line); border-radius: 11px; background: #f8fbfa; }
.price-row { display: flex; justify-content: space-between; gap: 10px; padding: 4px 0; font-size: 12px; }
.price-row.total { margin-top: 5px; padding-top: 9px; border-top: 1px solid var(--line); font: 800 16px var(--font-ui); color: var(--brand-dark); }
.price-row.paid { color: var(--green); font-weight: 700; }
.chips { display: flex; flex-wrap: wrap; }
.pay-info { flex: 1; min-width: 0; }
.block { display: block; }
.focused-form { margin-top: 12px; padding: 11px; border: 1px solid #b9ddd7; border-radius: 10px; background: #fff; }
.focused-form .ff + .ff { margin-top: 8px; }
.payment-form { margin: 0 0 16px; background: #f4faf8; }
.payment-fields { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; }
.form-actions { display: flex; gap: 7px; margin-top: 10px; }
.form-close { display: grid; place-items: center; width: 27px; height: 27px; border: 0; border-radius: 7px; background: #eef3f2; color: var(--muted); cursor: pointer; }
.more-actions { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 8px; }
.more-toggle { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border: 0; background: none; color: var(--muted); font: 600 10.5px var(--font-ui); cursor: pointer; }
.more-menu { display: flex; flex-direction: column; gap: 5px; margin-top: 4px; }
.more-menu > button { display: flex; align-items: center; gap: 8px; padding: 7px; border: 1px solid var(--line); border-radius: 8px; background: #fff; text-align: left; color: var(--ink); cursor: pointer; }
.more-menu b, .more-menu small { display: block; }
.more-menu b { font-size: 10.5px; }.more-menu small { color: var(--muted); font-size: 8.5px; }
.more-menu .danger-action { color: var(--red); border-color: #f2d3d0; }
.payment-row { display: flex; align-items: center; gap: 9px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 12px; }
.handoff-record { display: flex; align-items: center; gap: 9px; margin: 10px 0; padding: 9px 11px; border-radius: 9px; background: var(--brand-light); color: var(--brand-dark); }
.handoff-record b, .handoff-record small { display: block; }
.handoff-record b { font-size: 11.5px; }
.handoff-record small { color: var(--muted); font-size: 9.5px; }
.timeline { display: flex; flex-direction: column; }
.timeline-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 9px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line); }
.timeline-mark { display: grid; place-items: center; width: 25px; height: 25px; border-radius: 50%; background: var(--brand-light); color: var(--brand); }
.timeline-row b, .timeline-row small { display: block; }.timeline-row b { font-size: 11.5px; text-transform: capitalize; }.timeline-row small, .timeline-row time { color: var(--muted); font-size: 9.5px; }
.loading-detail { padding: 10px 0; }
.footer-context { margin-right: auto; min-width: 0; }.footer-context b { text-transform: capitalize; }.footer-context b, .footer-context span { display: block; font-size: 10px; }.footer-context span { color: var(--muted); }
.footer-actions { display: flex; gap: 7px; }
@media (max-width: 760px) {
  .overview-grid { grid-template-columns: 1fr; }
  .pricing-card { position: static; }
  .payment-fields { grid-template-columns: 1fr; }
  .order-summary { grid-template-columns: 1fr 1fr; }
  .customer-summary { grid-column: 1 / -1; }
}
@media (max-width: 640px) {
  .summary-stat { min-width: 0; text-align: left; border-left: 0; padding: 6px 0; }
  .footer-context { display: none; }
  .footer-actions { width: 100%; flex-wrap: wrap; }
  .footer-actions > :deep(.btn) { flex: 1 1 calc(50% - 4px); }
  .payment-row { align-items: flex-start; flex-wrap: wrap; }
  .timeline-row { grid-template-columns: auto minmax(0, 1fr); }
  .timeline-row time { grid-column: 2; }
}
</style>
