<script setup>
// Pickup & payment flow for a ready order. Payment happens HERE, not at order
// creation: the operator pushes an STK, enters the customer's M-Pesa reference,
// or takes cash — every payment is recorded against the order's tag. Handover
// closes the order (revenue recognition).
import { ref, onMounted, computed } from 'vue';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { money } from '../utils/format.js';
import Modal from './Modal.vue';
import FormField from './FormField.vue';
import StatusBadge from './StatusBadge.vue';
import AppIcon from './AppIcon.vue';
import ComboBox from './ComboBox.vue';

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
    await api.post(`/orders/${order.value.id}/advance`, {
      to: 'delivered',
      handoff_type: handoffType.value,
      collected_by_name: collectedByName.value.trim(),
    });
    toast.success(`${order.value.code} handed over to ${collectedByName.value.trim()} — ${money(order.value.totalCents, session.currency)} recognized as revenue`);
    emit('collected');
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}
</script>

<template>
  <Modal :title="order ? `Coletar — pedido ${order.code}` : 'Coletar'" @close="$emit('close')">
    <div v-if="order">
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

      <div v-for="item in order.items" :key="item.id" class="li-line muted small">
        {{ item.qty }} {{ item.unit }} · {{ item.serviceName }}<template v-if="item.variantLabel"> ({{ item.variantLabel }})</template>
        — {{ money(item.lineTotalCents, session.currency) }}
      </div>

      <template v-if="!paid">
        <div v-if="pendingStk" class="stk-wait">
          <StatusBadge status="pending" kind="generic" label="Pix enviado" />
          <span class="small">Waiting for the customer to enter their M-Pesa PIN ({{ money(pendingStk.amountCents, session.currency) }})…</span>
          <button class="btn btn-green btn-sm" :disabled="busy" @click="confirmStk">Confirm received</button>
        </div>
        <template v-else>
          <label class="field-label" style="margin-top: 12px;">Receber pagamento</label>
          <div class="row">
            <FormField label="Método">
              <select v-model="method">
                <option value="mpesa_manual">M-Pesa — enter reference</option>
                <option value="cash">Cash</option>
                <option value="mpesa_stk" disabled>M-Pesa STK push — Coming soon</option>
              </select>
            </FormField>
            <FormField :label="`Valor (${session.currency})`">
              <input v-model.number="amount" type="number" min="1" />
            </FormField>
          </div>
          <div v-if="method === 'mpesa_manual'" class="row">
            <FormField label="Código Pix" :error="refError"
              hint="Do comprovante do cliente — registrado neste pedido">
              <input v-model="mpesaRef" type="text" placeholder="ex. 123e4567-e89b" style="text-transform: uppercase;" />
            </FormField>
          </div>
          <button class="btn btn-green" :disabled="busy" @click="takePayment">
            <AppIcon name="cash" :size="14" />
            Record payment
          </button>
        </template>
      </template>

      <div v-if="order.payments.some((p) => p.status === 'completed')" class="paid-list">
        <label class="field-label" style="margin-top: 12px;">Pagamentos deste pedido</label>
        <div v-for="p in order.payments.filter((x) => x.status === 'completed')" :key="p.id" class="paid-row small">
          <StatusBadge status="completed" kind="generic" />
          {{ p.method.replace('_', ' ') }} · <b>{{ money(p.amountCents, session.currency) }}</b>
          <code v-if="p.mpesaRef" class="ref">{{ p.mpesaRef }}</code>
        </div>
      </div>

      <div class="handoff-box" :class="{ locked: !paid && !creditApproved }">
        <div class="handoff-title">
          <div>
            <b>Order handoff</b>
            <small>{{ paid ? 'Record who receives the finished order.' : creditApproved ? 'Approved customer credit will be recorded against this order.' : 'Full payment is required before handoff.' }}</small>
          </div>
          <StatusBadge :status="paid ? 'paid' : order.paymentStatus" kind="payment" />
        </div>
        <div class="handoff-fields">
          <FormField label="Handoff type">
            <select v-model="handoffType" :disabled="!paid">
              <option value="pickup">Customer pickup</option>
              <option value="delivery">Taken for delivery</option>
            </select>
          </FormField>
          <FormField :label="handoffType === 'pickup' ? 'Coletado por' : 'Entregue por'"
            hint="Selecione o cliente ou digite o nome de outra pessoa.">
            <ComboBox v-model="collectedByName" :items="customerOption" :allow-create="false"
              placeholder="Type or select a name…" @select="selectPerson" />
          </FormField>
        </div>
      </div>
    </div>
    <div v-else class="muted" style="padding: 16px; text-align: center;">Loading…</div>

    <template #footer>
      <button class="btn btn-ghost" @click="$emit('close')">Close</button>
      <button v-if="order" class="btn btn-primary" :disabled="!canHandOver" @click="handOver"
        :title="!paid && !creditApproved ? 'Full payment is required before pickup' : !collectedByName.trim() ? 'Record who receives the order' : ''">
        <AppIcon name="check" :size="14" />
        {{ !paid && creditApproved ? 'Complete handoff on credit' : !paid ? 'Payment required before handoff' : 'Complete handoff' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.collect-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.tag-chip {
  display: inline-flex; align-items: center; gap: 7px; background: var(--side); color: #7ed7c9;
  font: 800 15px var(--font-ui); letter-spacing: 0.06em; padding: 7px 13px; border-radius: 10px;
}
.balance { margin-left: auto; text-align: right; }
.balance b { display: block; font-size: 18px; font-family: var(--font-ui); }
.block { display: block; }
.li-line { padding: 2px 0; }
.stk-wait { display: flex; align-items: center; gap: 10px; background: #fdf6ea; border: 1px solid #f0dfc0; border-radius: 10px; padding: 10px 12px; margin-top: 12px; flex-wrap: wrap; }
.paid-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.ref { background: #eef2f7; padding: 1px 7px; border-radius: 4px; font-size: 11px; }
.handoff-box { margin-top: 14px; padding: 11px; border: 1px solid #b9ddd7; border-radius: 10px; background: #f4faf8; }
.handoff-box.locked { border-color: #f0cbc7; background: #fff8f7; }
.handoff-title { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 9px; }
.handoff-title b, .handoff-title small { display: block; }
.handoff-title b { font-size: 12px; }
.handoff-title small { color: var(--muted); font-size: 9.5px; }
.handoff-fields { display: grid; grid-template-columns: 150px 1fr; gap: 10px; }
.handoff-box.locked .handoff-fields { opacity: .55; pointer-events: none; }
@media (max-width: 520px) { .handoff-fields { grid-template-columns: 1fr; } }
</style>
