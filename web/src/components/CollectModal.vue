<script setup>
// Pickup & payment flow for a ready order. Payment happens HERE, not at order
// creation: the operator pushes an STK, enters the customer's M-Pesa reference,
// or takes cash — every payment is recorded against the order's tag. Handover
// closes the order (revenue recognition).
import { ref, onMounted, computed, watch } from 'vue';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { money } from '../utils/format.js';
import Modal from './Modal.vue';
import FormField from './FormField.vue';
import StatusBadge from './StatusBadge.vue';
import AppIcon from './AppIcon.vue';
import ComboBox from './ComboBox.vue';
import AppSelect from './AppSelect.vue';
import BaseButton from './BaseButton.vue';

const props = defineProps({ orderId: { type: String, required: true } });
const emit = defineEmits(['close', 'collected']);

const session = useSession();
const toast = useToast();
const order = ref(null);
const busy = ref(false);
const method = ref('mpesa_manual');
const amount = ref(0);
const mpesaRef = ref('');
const refError = ref('');
const pendingStk = ref(null); // payment awaiting the customer's PIN
const handoffType = ref('pickup');
const collectedByName = ref('');

async function load() {
  order.value = await api.get(`/orders/${props.orderId}`);
  amount.value = order.value.balanceCents / 100;
  pendingStk.value = order.value.payments.find((p) => p.status === 'pending' && p.method === 'mpesa_stk') || null;
  if (!collectedByName.value) collectedByName.value = order.value.customer?.name || '';
}
onMounted(load);

const balance = computed(() => order.value?.balanceCents ?? 0);
const paid = computed(() => order.value && balance.value <= 0);
const creditApproved = computed(() => !!order.value?.customer?.creditEnabled);
const customerOption = computed(() => order.value ? [{
  id: order.value.customer.id,
  label: order.value.customer.name,
  sub: order.value.customer.phone,
}] : []);
const canHandOver = computed(() => (paid.value || creditApproved.value) && collectedByName.value.trim() && !busy.value);

// who receives the order depends on the handoff type: in-person → the
// customer; delivery → the business's delivery providers (riders)
const deliveryProviders = ref(null); // null = not fetched yet
watch(handoffType, async (t) => {
  if (t === 'delivery') {
    collectedByName.value = '';
    if (deliveryProviders.value === null) {
      try { deliveryProviders.value = await api.get('/service-providers/delivery'); }
      catch { deliveryProviders.value = []; }
    }
    if (deliveryProviders.value.length === 1) collectedByName.value = deliveryProviders.value[0].name;
  } else {
    collectedByName.value = order.value?.customer?.name || '';
  }
});
const peopleOptions = computed(() => (handoffType.value === 'delivery'
  ? (deliveryProviders.value || []).map((p) => ({ id: p.id, label: p.name, sub: p.phone || 'delivery provider' }))
  : customerOption.value));
const personHint = computed(() => (handoffType.value === 'delivery'
  ? (peopleOptions.value.length ? 'Choose one of your delivery providers, or type a rider’s name.' : 'No delivery providers yet — add them under Finance → Service providers, or type a name.')
  : 'Select the customer or type the name of whoever collects for them.'));

function selectPerson(person) {
  collectedByName.value = person.label;
}

async function takePayment() {
  refError.value = '';
  if (method.value === 'mpesa_manual' && !mpesaRef.value.trim()) {
    refError.value = 'Enter the M-Pesa reference from the customer’s confirmation SMS';
    return;
  }
  busy.value = true;
  try {
    const updated = await api.post(`/orders/${order.value.id}/payments`, {
      method: method.value,
      amount_cents: Math.round(amount.value * 100),
      mpesa_ref: mpesaRef.value.trim() || undefined,
    });
    order.value = updated;
    amount.value = updated.balanceCents / 100;
    toast.success(`Payment recorded against tag ${order.value.code}${mpesaRef.value ? ` · ref ${mpesaRef.value.trim().toUpperCase()}` : ''}`);
    mpesaRef.value = '';
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}

async function confirmStk() {
  busy.value = true;
  try {
    await api.post(`/payments/${pendingStk.value.id}/simulate`);
    pendingStk.value = null;
    await load();
    toast.success(`M-Pesa payment confirmed against tag ${order.value.code}`);
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}

async function handOver() {
  busy.value = true;
  try {
    // when the name matches one of our delivery providers, the server SMSes
    // them the run with a confirm link — the customer's delivered message
    // then waits for the rider's confirmation
    const rider = handoffType.value === 'delivery'
      ? (deliveryProviders.value || []).find((p) => p.name === collectedByName.value.trim())
      : null;
    await api.post(`/orders/${order.value.id}/advance`, {
      to: 'delivered',
      handoff_type: handoffType.value,
      collected_by_name: collectedByName.value.trim(),
      delivery_provider_id: rider?.id || undefined,
    });
    toast.success(`${order.value.code} handed over to ${collectedByName.value.trim()} — ${money(order.value.totalCents, session.currency)} recognized as revenue`);
    emit('collected');
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}
</script>

<template>
  <Modal :title="order ? `Complete handoff · ${order.code}` : 'Complete handoff'"
    :subtitle="order ? `${order.customer?.name || 'Customer'} · ${money(order.totalCents, session.currency)}` : 'Loading order information'"
    :close-on-backdrop="!busy" @close="$emit('close')">
    <div v-if="order">
      <div class="handoff-steps">
        <div :class="{ done: paid || creditApproved }"><span>1</span><b>{{ paid ? 'Payment complete' : creditApproved ? 'Credit approved' : 'Settle payment' }}</b></div>
        <AppIcon name="chevronRight" :size="13" />
        <div :class="{ done: canHandOver }"><span>2</span><b>Confirm recipient</b></div>
      </div>
      <div class="collect-head">
        <div class="tag-chip"><AppIcon name="tag" :size="14" />{{ order.code }}</div>
        <div>
          <b>{{ order.customer?.name }}</b>
          <small class="muted block">{{ order.customer?.phone }}</small>
        </div>
        <div class="balance">
          <small class="muted">Balance</small>
          <b :class="balance > 0 ? 'text-red' : 'text-green'">{{ money(balance, session.currency) }}</b>
        </div>
      </div>

      <details class="order-items"><summary>{{ order.items.length }} service{{ order.items.length === 1 ? '' : 's' }} in this order</summary><div v-for="item in order.items" :key="item.id" class="li-line muted small">{{ item.qty }} {{ item.unit }} · {{ item.serviceName }}<template v-if="item.variantLabel"> ({{ item.variantLabel }})</template> — {{ money(item.lineTotalCents, session.currency) }}</div></details>

      <template v-if="!paid">
        <div v-if="pendingStk" class="stk-wait">
          <StatusBadge status="pending" kind="generic" label="STK sent" />
          <span class="small">Waiting for the customer to enter their M-Pesa PIN ({{ money(pendingStk.amountCents, session.currency) }})…</span>
          <button class="btn btn-green btn-sm" :disabled="busy" @click="confirmStk">Confirm received</button>
        </div>
        <template v-else>
          <div class="flow-title"><span class="flow-icon"><AppIcon name="cash" :size="16" /></span><div><b>Settle the balance</b><small>Record how the customer paid before handoff.</small></div></div>
          <div class="row">
            <FormField label="Method">
              <AppSelect v-model="method">
                <option value="mpesa_manual">M-Pesa — enter reference</option>
                <option value="cash">Cash</option>
                <option value="mpesa_stk" disabled>M-Pesa STK push — Coming soon</option>
              </AppSelect>
            </FormField>
            <FormField :label="`Amount (${session.currency})`">
              <input v-model.number="amount" type="number" min="1" />
            </FormField>
          </div>
          <div v-if="method === 'mpesa_manual'" class="row">
            <FormField label="M-Pesa reference" :error="refError"
              hint="From the customer's confirmation SMS — stored against this tag">
              <input v-model="mpesaRef" type="text" placeholder="e.g. SGH61KXTOP" style="text-transform: uppercase;" />
            </FormField>
          </div>
          <BaseButton variant="green" icon="cash" :loading="busy" @click="takePayment">Record payment</BaseButton>
        </template>
      </template>

      <div v-if="order.payments.some((p) => p.status === 'completed')" class="paid-list">
        <label class="field-label" style="margin-top: 12px;">Payments on this tag</label>
        <div v-for="p in order.payments.filter((x) => x.status === 'completed')" :key="p.id" class="paid-row small">
          <StatusBadge status="completed" kind="generic" />
          {{ p.method.replace('_', ' ') }} · <b>{{ money(p.amountCents, session.currency) }}</b>
          <code v-if="p.mpesaRef" class="ref">{{ p.mpesaRef }}</code>
        </div>
      </div>

      <div class="handoff-box" :class="{ locked: !paid && !creditApproved }">
        <div class="handoff-title">
          <span class="flow-icon"><AppIcon name="user" :size="16" /></span>
          <div>
            <b>Order handoff</b>
            <small>{{ paid ? 'Record who receives the finished order.' : creditApproved ? 'Approved customer credit will be recorded against this order.' : 'Full payment is required before handoff.' }}</small>
          </div>
          <StatusBadge :status="paid ? 'paid' : order.paymentStatus" kind="payment" />
        </div>
        <div class="handoff-fields">
          <FormField label="Handoff type">
            <AppSelect v-model="handoffType" :disabled="!paid">
              <option value="pickup">Customer pickup</option>
              <option value="delivery">Taken for delivery</option>
            </AppSelect>
          </FormField>
          <FormField :label="handoffType === 'pickup' ? 'Collected by' : 'Taken for delivery by'"
            :hint="personHint">
            <ComboBox v-model="collectedByName" :items="peopleOptions" :allow-create="false"
              :placeholder="handoffType === 'delivery' ? 'Choose a delivery provider…' : 'Type or select a name…'"
              @select="selectPerson" />
          </FormField>
        </div>
      </div>
    </div>
    <div v-else class="muted" style="padding: 16px; text-align: center;">Loading…</div>

    <template #footer>
      <BaseButton variant="ghost" :disabled="busy" @click="$emit('close')">Close</BaseButton>
      <BaseButton v-if="order" icon="check" :loading="busy" :disabled="!canHandOver" @click="handOver"
        :title="!paid && !creditApproved ? 'Full payment is required before pickup' : !collectedByName.trim() ? 'Record who receives the order' : ''">
        {{ !paid && creditApproved ? 'Complete handoff on credit' : !paid ? 'Payment required before handoff' : 'Complete handoff' }}
      </BaseButton>
    </template>
  </Modal>
</template>

<style scoped>
.collect-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.handoff-steps { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 13px; padding: 8px; border-radius: 10px; background: #f4f7f6; color: var(--muted); }
.handoff-steps > div { display: flex; align-items: center; gap: 5px; }
.handoff-steps span { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: #dfe8e6; font-size: 9px; font-weight: 800; }
.handoff-steps b { font-size: 10px; }.handoff-steps .done { color: var(--brand-dark); }.handoff-steps .done span { background: var(--brand); color: #fff; }
.tag-chip {
  display: inline-flex; align-items: center; gap: 7px; background: var(--side); color: #7ed7c9;
  font: 800 15px var(--font-ui); letter-spacing: 0.06em; padding: 7px 13px; border-radius: 10px;
}
.balance { margin-left: auto; text-align: right; }
.balance b { display: block; font-size: 18px; font-family: var(--font-ui); }
.block { display: block; }
.li-line { padding: 2px 0; }
.order-items { margin: 9px 0 12px; padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px; background: #fafcfc; }
.order-items summary { color: var(--muted); font-size: 10.5px; font-weight: 600; cursor: pointer; }
.order-items[open] summary { margin-bottom: 5px; }
.flow-title { display: flex; align-items: center; gap: 8px; margin: 12px 0 9px; }
.flow-title b, .flow-title small { display: block; }.flow-title b { font-size: 12px; }.flow-title small { color: var(--muted); font-size: 9.5px; }
.flow-icon { display: grid; place-items: center; flex: 0 0 auto; width: 30px; height: 30px; border-radius: 8px; color: var(--brand); background: var(--brand-light); }
.stk-wait { display: flex; align-items: center; gap: 10px; background: #fdf6ea; border: 1px solid #f0dfc0; border-radius: 10px; padding: 10px 12px; margin-top: 12px; flex-wrap: wrap; }
.paid-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.ref { background: #eef2f7; padding: 1px 7px; border-radius: 4px; font-size: 11px; }
.handoff-box { margin-top: 14px; padding: 11px; border: 1px solid #b9ddd7; border-radius: 10px; background: #f4faf8; }
.handoff-box.locked { border-color: #f0cbc7; background: #fff8f7; }
.handoff-title { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 9px; }
.handoff-title > div { flex: 1; }
.handoff-title b, .handoff-title small { display: block; }
.handoff-title b { font-size: 12px; }
.handoff-title small { color: var(--muted); font-size: 9.5px; }
.handoff-fields { display: grid; grid-template-columns: 150px 1fr; gap: 10px; }
.handoff-box.locked .handoff-fields { opacity: .55; pointer-events: none; }
@media (max-width: 520px) { .handoff-fields { grid-template-columns: 1fr; } }
</style>
