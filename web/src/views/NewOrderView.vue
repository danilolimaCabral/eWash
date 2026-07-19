<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { useCatalog } from '../stores/catalog.js';
import { money } from '../utils/format.js';
import Panel from '../components/Panel.vue';
import FormField from '../components/FormField.vue';
import DatePicker from '../components/DatePicker.vue';
import ComboBox from '../components/ComboBox.vue';
import AppIcon from '../components/AppIcon.vue';

const session = useSession();
const toast = useToast();

const catalog = ref({ categories: [], services: [] });
const customers = ref([]);
const custQuery = ref('');
const customer = ref(null); // { id?, name, phone }
const custPhone = ref('');
const express = ref(false);
const lines = ref([]); // [{ serviceId, variantId, qty, addons: [addonServiceId] }]
const preview = ref(null);
const sentOrder = ref(null);
const busy = ref(false);
const historical = ref(false);
const historyForm = ref({
  order_date: new Date().toLocaleDateString('sv-SE'),
  fulfilled_date: new Date().toLocaleDateString('sv-SE'),
  handoff_type: 'pickup', collected_by_name: '',
  payment_method: 'mpesa_manual', payment_amount: 0, payment_ref: '',
});

// add-line form state
const svcId = ref('');
const variantId = ref('');
const qty = ref(7);
const pickedAddons = ref([]);

const svc = computed(() => catalog.value.services.find((s) => s.id === svcId.value));
const qtyLabel = computed(() =>
  svc.value?.pricingModel === 'PER_KG' || svc.value?.unit === 'kg' ? 'Weight (kg)'
  : svc.value?.pricingModel === 'FLAT' ? 'Bags' : 'Quantity');
const addonOptions = computed(() =>
  (svc.value?.addonRules || []).map((r) => {
    const a = catalog.value.services.find((x) => x.id === r.addonServiceId);
    return a && { rule: r, addon: a, effRate: r.overrideRateCents ?? a.baseRateCents };
  }).filter(Boolean));

const catalogStore = useCatalog();
async function load() {
  try {
    [catalog.value, customers.value] = await Promise.all([catalogStore.load(), api.get('/customers')]);
    svcId.value = catalog.value.services[0]?.id || '';
  } catch (e) { toast.error(e.message); }
}
onMounted(load);

watch(svcId, () => {
  variantId.value = svc.value?.variants?.[0]?.id || '';
  pickedAddons.value = [];
  qty.value = svc.value?.unit === 'kg' ? 7 : 1;
});

const customerItems = computed(() =>
  customers.value.map((c) => ({ id: c.id, label: c.name, sub: c.phone })));

function pickCustomer(item) {
  const c = customers.value.find((x) => x.id === item.id);
  customer.value = { id: c.id, name: c.name, phone: c.phone };
  custQuery.value = c.name;
  custPhone.value = c.phone;
}
function newCustomer(name) {
  customer.value = { name, phone: custPhone.value };
  toast.show(`New customer “${name}” will be created with this order${custPhone.value ? '' : ' — add a phone number'}`);
}

function addLine() {
  if (!svc.value) return;
  if (!(qty.value > 0)) { toast.error('Enter a valid quantity'); return; }
  lines.value.push({
    serviceId: svcId.value,
    variantId: svc.value.variants.length ? variantId.value : null,
    qty: qty.value,
    addons: pickedAddons.value.map((id) => ({ addonServiceId: id })),
  });
  pickedAddons.value = [];
  refreshPreview();
}
function removeLine(i) {
  lines.value.splice(i, 1);
  refreshPreview();
}

async function refreshPreview() {
  if (!lines.value.length) { preview.value = null; return; }
  try {
    preview.value = await api.post('/orders/preview', {
      express: express.value,
      items: lines.value,
    });
  } catch (e) { toast.error(e.message); }
}
watch(express, refreshPreview);

const smsPreview = computed(() => {
  if (!preview.value) return '';
  const name = (customer.value?.name || 'Customer').split(' ')[0];
  const items = preview.value.lines.map((l) => {
    const q = l.unit === 'kg' ? `${l.qty}kg` : `${l.qty}×`;
    return `${l.serviceName}${l.variantLabel ? ` (${l.variantLabel})` : ''} ${q}: ${money(l.lineTotalCents, session.currency)}`
      + l.addons.map((a) => ` +${a.addonName}: ${money(a.totalCents, session.currency)}`).join('');
  }).join('; ');
  return `eWash: Hello ${name}, your order has been assessed: ${items}. Total ${money(preview.value.totalCents, session.currency)}. Pay by M-Pesa or cash when you pick up. Karibu!`;
});

async function sendQuote() {
  if (!lines.value.length) { toast.error('Add at least one service line first'); return; }
  if (!customer.value?.name) { toast.error('Pick or add a customer first'); return; }
  if (!(customer.value.id || custPhone.value.trim())) { toast.error('A phone number is required — it is how the customer gets the quote'); return; }
  busy.value = true;
  try {
    const body = {
      express: express.value,
      items: lines.value,
      ...(historical.value ? {
        historical: true, order_date: historyForm.value.order_date,
        fulfilled_date: historyForm.value.fulfilled_date,
        handoff_type: historyForm.value.handoff_type,
        collected_by_name: historyForm.value.collected_by_name || customer.value.name,
        payment: historyForm.value.payment_amount > 0 ? {
          method: historyForm.value.payment_method,
          amount_cents: Math.round(historyForm.value.payment_amount * 100),
          mpesa_ref: historyForm.value.payment_ref || undefined,
          date: historyForm.value.fulfilled_date,
        } : undefined,
      } : {}),
      ...(customer.value.id
        ? { customer_id: customer.value.id }
        : { customer: { name: customer.value.name, phone: custPhone.value } }),
    };
    sentOrder.value = await api.post('/orders', body);
    toast.success(historical.value
      ? `Historical order ${sentOrder.value.code} recorded for ${historyForm.value.fulfilled_date}`
      : `Order ${sentOrder.value.code} created in “Received” — quote sent`);
    lines.value = [];
    preview.value = null;
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}

function clearAll() {
  lines.value = [];
  preview.value = null;
  sentOrder.value = null;
  customer.value = null;
  custQuery.value = '';
  custPhone.value = '';
}
</script>

<template>
  <div>
    <div class="section-head">
      <div>
        <h2>New Order — Assessment</h2>
        <p>Intake → <b>Assessment</b> → Confirmation → Processing · price snapshot locks at customer confirmation</p>
      </div>
      <label v-if="session.can('finance.manage')" class="historical-toggle"><input v-model="historical" type="checkbox" /> Record historical fulfilled order</label>
    </div>

    <Panel v-if="historical" title="Historical accounting details" subtitle="Admin-only · dates determine the accounting month">
      <div class="history-grid">
        <FormField label="Order date"><DatePicker v-model="historyForm.order_date" /></FormField>
        <FormField label="Fulfilled / revenue date"><DatePicker v-model="historyForm.fulfilled_date" /></FormField>
        <FormField label="Handoff"><select v-model="historyForm.handoff_type"><option value="pickup">Picked up</option><option value="delivery">Delivered</option></select></FormField>
        <FormField label="Collected / delivered by"><input v-model="historyForm.collected_by_name" type="text" placeholder="Defaults to customer" /></FormField>
        <FormField label="Payment method"><select v-model="historyForm.payment_method"><option value="mpesa_manual">Manual M-Pesa</option><option value="cash">Cash</option></select></FormField>
        <FormField :label="`Payment amount (${session.currency})`"><input v-model.number="historyForm.payment_amount" type="number" min="0" /></FormField>
        <FormField v-if="historyForm.payment_method === 'mpesa_manual' && historyForm.payment_amount > 0" label="M-Pesa code"><input v-model="historyForm.payment_ref" type="text" /></FormField>
      </div>
    </Panel>

    <div class="intake-grid">
      <div style="flex: 2;">
        <FormField label="Customer — search or add new">
          <ComboBox v-model="custQuery" :items="customerItems" placeholder="Type a name or phone…"
            @select="pickCustomer" @create="newCustomer" />
        </FormField>
      </div>
      <FormField label="Phone">
        <input v-model="custPhone" type="tel" placeholder="07xx xxx xxx" :disabled="!!customer?.id" />
      </FormField>
      <FormField label="Express (same day)">
        <select v-model="express">
          <option :value="false">No</option>
          <option :value="true">Yes — surcharge applies</option>
        </select>
      </FormField>
    </div>

    <div class="new-order-grid">
    <Panel title="Add service line" :subtitle="`${addonOptions.length} configured rider${addonOptions.length === 1 ? '' : 's'} for this service`">
      <div class="row">
        <FormField label="Service">
          <select v-model="svcId">
            <option v-for="s in catalog.services" :key="s.id" :value="s.id">
              {{ s.name }} — {{ s.pricingModel === 'FLAT' ? money(s.baseRateCents, session.currency) : money(s.baseRateCents, session.currency) + '/' + s.unit }}
            </option>
          </select>
        </FormField>
        <FormField v-if="svc?.variants?.length" label="Variant">
          <select v-model="variantId">
            <option v-for="v in svc.variants" :key="v.id" :value="v.id">{{ v.label }} — {{ money(v.priceCents, session.currency) }}</option>
          </select>
        </FormField>
        <FormField :label="qtyLabel">
          <input v-model.number="qty" type="number" min="0.5" step="0.5" />
        </FormField>
      </div>
      <div class="addons">
        <div class="addons-head">
          <label class="field-label">Riders / add-ons</label>
          <span v-if="addonOptions.length" class="rider-count">{{ addonOptions.length }} available</span>
        </div>
        <div v-if="addonOptions.length" class="rider-grid">
        <label v-for="o in addonOptions" :key="o.addon.id" class="addon-check"
          :class="{ selected: pickedAddons.includes(o.addon.id) }">
          <input v-model="pickedAddons" type="checkbox" :value="o.addon.id" />
          <span class="rider-copy">
            <b>{{ o.addon.name }}</b>
            <small>{{ money(o.effRate, session.currency) }}/{{ o.addon.unit }}</small>
          </span>
          <span class="rider-meta">
            <em v-if="o.rule.overrideRateCents != null">bundled</em>
            <em v-if="o.rule.inheritQty">inherits qty</em>
          </span>
        </label>
        </div>
        <div v-else class="no-riders">
          No riders are configured for {{ svc?.name }}. Attach services to it in Service Builder when needed.
        </div>
      </div>
      <button class="btn btn-primary" @click="addLine"><AppIcon name="plus" :size="14" /> Add to order</button>
    </Panel>

    <div class="order-cols">
      <Panel title="Order summary" :subtitle="`${preview?.lines?.length || 0} service line${preview?.lines?.length === 1 ? '' : 's'}`">
        <div v-if="!preview?.lines?.length" class="muted small">No lines yet — add a service above.</div>
        <div v-for="(l, i) in preview?.lines || []" :key="i" class="lineitem">
          <div class="li-head">
            <span>{{ l.serviceName }}<template v-if="l.variantLabel"> · {{ l.variantLabel }}</template></span>
            <span>{{ money(l.lineTotalCents, session.currency) }}</span>
          </div>
          <div class="li-sub">
            {{ l.qty }} {{ l.unit }} × {{ money(l.unitPriceCents, session.currency) }}
            <b v-if="l.minApplied"> — minimum charge applied</b>
            <a href="#" class="text-red small" @click.prevent="removeLine(i)"> remove</a>
          </div>
          <span v-for="(a, j) in l.addons" :key="j" class="addon-chip">
            ↳ {{ a.addonName }} · {{ a.qty }} {{ a.unit }} × {{ money(a.unitPriceCents, session.currency) }} = {{ money(a.totalCents, session.currency) }}{{ a.qtyInherited ? ' (qty inherited)' : '' }}
          </span>
        </div>
        <div v-if="preview" class="totals">
          <div class="tr"><span>Subtotal</span><span>{{ money(preview.subtotalCents, session.currency) }}</span></div>
          <div v-if="preview.expressCents" class="tr"><span>Express surcharge</span><span>{{ money(preview.expressCents, session.currency) }}</span></div>
          <div class="tr grand"><span>Total</span><span>{{ money(preview.totalCents, session.currency) }}</span></div>
          <div class="small muted">Price snapshot locks at customer confirmation</div>
        </div>
        <div class="actions">
          <button class="btn btn-green" :disabled="busy || !lines.length" @click="sendQuote">
            <AppIcon name="send" :size="14" /> {{ historical ? 'Record fulfilled order' : 'Create order & send quote' }}
          </button>
          <button class="btn btn-ghost" @click="clearAll">Clear</button>
        </div>
      </Panel>

      <div v-if="smsPreview || sentOrder" class="phone">
        <div class="small muted" style="text-align:center; margin-bottom:8px;">CUSTOMER'S PHONE</div>
        <div class="sms">
          <template v-if="sentOrder"><b>eWash:</b> Hello {{ sentOrder.customer.name.split(' ')[0] }}, order <b>{{ sentOrder.code }}</b> assessed. Total <b>{{ money(sentOrder.totalCents, session.currency) }}</b>. Pay by M-Pesa or cash when you pick up. Karibu!</template>
          <template v-else>{{ smsPreview }}</template>
        </div>
        <div class="mpesa">
          <div class="small" style="opacity:.85;">M-PESA — {{ session.tenant?.name }}</div>
          <div class="amt">{{ money(sentOrder ? sentOrder.totalCents : preview?.totalCents || 0, session.currency) }}</div>
          <div class="small" style="margin-top:4px;">Enter PIN to pay</div>
        </div>
      </div>
    </div>
    </div>
  </div>
</template>

<style scoped>
.intake-grid {
  display: grid; grid-template-columns: minmax(280px, 2fr) minmax(180px, 1fr) minmax(180px, 1fr);
  gap: 12px; margin-bottom: 14px;
}
.historical-toggle { display: flex; align-items: center; gap: 7px; color: var(--brand); font-size: 11px; font-weight: 600; }
.historical-toggle input { width: auto; }
.history-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 9px; }
.new-order-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(330px, .85fr); gap: 14px; align-items: start; }
.addons { margin-bottom: 12px; }
.addons-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.addons-head .field-label { margin-bottom: 0; }
.rider-count { color: var(--brand); background: var(--brand-light); border-radius: 999px; padding: 2px 8px; font-size: 9.5px; font-weight: 700; }
.rider-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; margin-top: 7px; }
.addon-check {
  min-height: 48px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center;
  gap: 8px; padding: 7px 9px; border: 1px solid var(--line); border-radius: 9px; background: #fff;
  font-size: 12px; cursor: pointer;
}
.addon-check:hover { border-color: #b9d8d3; }
.addon-check.selected { border-color: var(--brand); background: var(--brand-light); }
.addon-check input { width: auto; }
.rider-copy { min-width: 0; }
.rider-copy b, .rider-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rider-copy b { font-size: 11.5px; }
.rider-copy small { color: var(--muted); font-size: 9.5px; }
.rider-meta { display: flex; flex-direction: column; gap: 2px; align-items: flex-end; }
.rider-meta em { color: var(--brand-dark); background: #fff; border-radius: 999px; padding: 1px 6px; font-size: 8.5px; font-style: normal; white-space: nowrap; }
.no-riders { margin-top: 7px; padding: 9px 10px; border: 1px dashed #cddbd8; border-radius: 9px; color: var(--muted); background: #f8fbfa; font-size: 10.5px; }
.order-cols { display: flex; flex-direction: column; gap: 12px; position: sticky; top: 78px; min-width: 0; }
.order-cols > :first-child { width: 100%; min-width: 0 !important; }
.order-cols .phone { width: 100%; }
.actions { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
@media (max-width: 1100px) {
  .new-order-grid { grid-template-columns: minmax(0, 1.25fr) minmax(310px, .75fr); }
  .rider-grid { grid-template-columns: 1fr; }
}
@media (max-width: 820px) {
  .history-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .intake-grid { grid-template-columns: 1fr 1fr; }
  .intake-grid > :first-child { grid-column: 1 / -1; }
  .new-order-grid { grid-template-columns: 1fr; }
  .order-cols { position: static; }
  .rider-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .history-grid { grid-template-columns: 1fr; }
  .intake-grid { grid-template-columns: 1fr; gap: 9px; }
  .intake-grid > :first-child { grid-column: auto; }
  .rider-grid { grid-template-columns: 1fr; }
  .addon-check { min-height: 46px; }
  .actions .btn { flex: 1; justify-content: center; }
}
</style>
