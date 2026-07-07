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

const props = defineProps({ orderId: { type: String, required: true } });
const emit = defineEmits(['close', 'changed']);

const session = useSession();
const toast = useToast();
const order = ref(null);
const busy = ref(false);
const payForm = ref({ open: false, method: 'mpesa_manual', amount: 0, mpesa_ref: '' });
const discountForm = ref({ open: false, amount: 0, reason: '' });
const handoffOpen = ref(false);

const NEXT = { received: 'washing', washing: 'ironing', ironing: 'ready', ready: 'delivered' };

async function load() {
  order.value = await api.get(`/orders/${props.orderId}`);
}
onMounted(load);

const canAdvance = computed(() => order.value && NEXT[order.value.status] && session.can('orders.advance'));
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
  payForm.value = { open: true, method: 'mpesa_manual', amount: order.value.balanceCents / 100, mpesa_ref: '' };
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
  <Modal :title="order ? `Order ${order.code}` : 'Order'" wide @close="$emit('close')">
    <template #header-extra>
      <template v-if="order">
        <StatusBadge :status="order.status" />
        <StatusBadge :status="order.paymentStatus" kind="payment" />
        <StatusBadge v-if="order.express" status="generic" label="EXPRESS" />
      </template>
    </template>

    <div v-if="order" class="detail">
      <div class="who">
        <div>
          <b>{{ order.customer?.name }}</b>
          <small class="muted block">{{ order.customer?.phone }} · created {{ dateTime(order.createdAt) }}</small>
          <small v-if="order.confirmedAt" class="muted block">✔ quote confirmed {{ dateTime(order.confirmedAt) }} — price locked</small>
          <small v-else class="text-red block">quote not yet confirmed</small>
        </div>
        <div class="balance">
          <small class="muted">Balance due</small>
          <b :class="order.balanceCents > 0 ? 'text-red' : 'text-green'">{{ money(order.balanceCents, session.currency) }}</b>
        </div>
      </div>

      <div class="lineitem" v-for="item in order.items" :key="item.id">
        <div class="li-head">
          <span>{{ item.serviceName }}<template v-if="item.variantLabel"> · {{ item.variantLabel }}</template></span>
          <span>{{ money(item.lineTotalCents, session.currency) }}</span>
        </div>
        <div class="li-sub">
          {{ item.qty }} {{ item.unit }} × {{ money(item.unitPriceCents, session.currency) }}
          <b v-if="item.minApplied"> — minimum charge applied</b>
          <span v-for="tag in item.tags" :key="tag.id" class="addon-chip"><AppIcon name="tag" :size="11" />{{ tag.tagCode }}</span>
        </div>
        <span v-for="a in item.addons" :key="a.id" class="addon-chip">
          ↳ {{ a.addonName }} · {{ a.qty }} {{ a.unit }} × {{ money(a.unitPriceCents, session.currency) }} = {{ money(a.totalCents, session.currency) }}{{ a.qtyInherited ? ' (qty inherited)' : '' }}
        </span>
      </div>

      <div class="totals">
        <div class="tr"><span>Subtotal</span><span>{{ money(order.subtotalCents, session.currency) }}</span></div>
        <div v-if="order.expressCents" class="tr"><span>Express surcharge</span><span>{{ money(order.expressCents, session.currency) }}</span></div>
        <div v-if="order.discountCents" class="tr text-red"><span>Discount</span><span>−{{ money(order.discountCents, session.currency) }}</span></div>
        <div class="tr grand"><span>Total</span><span>{{ money(order.totalCents, session.currency) }}</span></div>
        <div class="tr"><span class="muted">Paid</span><span class="text-green">{{ money(order.paidCents, session.currency) }}</span></div>
      </div>

      <div v-if="order.collectedAt" class="handoff-record">
        <AppIcon :name="order.handoffType === 'delivery' ? 'send' : 'checkCircle'" :size="17" />
        <div>
          <b>{{ order.handoffType === 'delivery' ? 'Taken for delivery' : 'Collected' }} by {{ order.collectedByName }}</b>
          <small>{{ dateTime(order.collectedAt) }}</small>
        </div>
      </div>

      <div class="actions">
        <button v-if="!order.confirmedAt && isOpen" class="btn btn-ghost btn-sm" :disabled="busy" @click="confirmQuote">
          <AppIcon name="check" :size="13" /> Confirm quote
        </button>
        <button v-if="canAdvance" class="btn btn-primary btn-sm" :disabled="busy" @click="advance">
          ▶ Move to {{ NEXT[order.status] }}
        </button>
        <button v-if="order.balanceCents > 0 && session.can('payments.receive')" class="btn btn-green btn-sm" :disabled="busy" @click="openPay">
          <AppIcon name="cash" :size="13" /> Take payment
        </button>
        <button v-if="isOpen && session.can('orders.discount')" class="btn btn-ghost btn-sm" :disabled="busy"
          @click="discountForm = { open: true, amount: 0, reason: '' }">Discount</button>
        <button v-if="isOpen && session.can('orders.void')" class="btn btn-danger btn-sm" :disabled="busy" @click="voidOpen = true">Void</button>
      </div>

      <div v-if="payForm.open" class="subform">
        <div class="row">
          <FormField label="Method">
            <select v-model="payForm.method">
              <option value="mpesa_manual">M-Pesa code (manual)</option>
              <option value="cash">Cash</option>
              <option value="mpesa_stk" disabled>M-Pesa STK push — Coming soon</option>
            </select>
          </FormField>
          <FormField :label="`Amount (${session.currency})`">
            <input v-model.number="payForm.amount" type="number" min="1" step="1" />
          </FormField>
          <FormField v-if="payForm.method === 'mpesa_manual'" label="M-Pesa code">
            <input v-model="payForm.mpesa_ref" type="text" placeholder="e.g. SGH61KXTOP" />
          </FormField>
        </div>
        <div class="actions">
          <button class="btn btn-green btn-sm" :disabled="busy" @click="takePayment">Record payment</button>
          <button class="btn btn-ghost btn-sm" @click="payForm.open = false">Cancel</button>
        </div>
      </div>

      <div v-if="discountForm.open" class="subform">
        <div class="row">
          <FormField :label="`Discount (${session.currency})`"><input v-model.number="discountForm.amount" type="number" min="1" /></FormField>
          <FormField label="Reason (audit log)"><input v-model="discountForm.reason" type="text" placeholder="e.g. loyal customer" /></FormField>
        </div>
        <div class="actions">
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="applyDiscount">Apply discount</button>
          <button class="btn btn-ghost btn-sm" @click="discountForm.open = false">Cancel</button>
        </div>
      </div>

      <div class="cols">
        <div>
          <h4>Payments</h4>
          <div v-if="!order.payments.length" class="muted small">No payments yet.</div>
          <div v-for="p in order.payments" :key="p.id" class="mini-row">
            <StatusBadge :status="p.status" kind="generic" />
            <span>{{ p.method.replace('_', ' ') }} · <b>{{ money(p.amountCents, session.currency) }}</b>
              <small v-if="p.mpesaRef" class="muted"> {{ p.mpesaRef }}</small></span>
            <small class="muted">{{ dateTime(p.at) }}</small>
            <button v-if="p.status === 'pending' && p.method === 'mpesa_stk'" class="btn btn-ghost btn-sm" :disabled="busy"
              @click="simulateCallback(p.id)">Simulate callback</button>
            <button v-if="p.status === 'completed' && session.can('payments.refund')" class="btn btn-danger btn-sm" :disabled="busy"
              @click="refundingId = p.id">Refund</button>
          </div>
        </div>
        <div>
          <h4>Status history</h4>
          <div v-for="h in order.history" :key="h.id" class="mini-row">
            <AppIcon name="history" :size="13" />
            <span>{{ h.fromStatus || '·' }} → <b>{{ h.toStatus }}</b></span>
            <small class="muted">{{ dateTime(h.at) }}</small>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="muted" style="padding: 20px; text-align: center;">Loading…</div>
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
.who { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.balance { text-align: right; }
.balance b { display: block; font-size: 19px; font-family: var(--font-ui); }
.block { display: block; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
.subform { background: #f4f9f8; border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin-bottom: 12px; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 6px; }
.cols h4 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin-bottom: 8px; }
.mini-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f0f4f3; font-size: 12px; flex-wrap: wrap; }
.handoff-record { display: flex; align-items: center; gap: 9px; margin: 10px 0; padding: 9px 11px; border-radius: 9px; background: var(--brand-light); color: var(--brand-dark); }
.handoff-record b, .handoff-record small { display: block; }
.handoff-record b { font-size: 11.5px; }
.handoff-record small { color: var(--muted); font-size: 9.5px; }
@media (max-width: 640px) { .cols { grid-template-columns: 1fr; } }
</style>
