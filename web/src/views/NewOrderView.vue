<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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
import BaseButton from '../components/BaseButton.vue';
import EmptyState from '../components/EmptyState.vue';
import Skeleton from '../components/Skeleton.vue';
import ToggleSwitch from '../components/ToggleSwitch.vue';
import AppSelect from '../components/AppSelect.vue';

const session = useSession();
const toast = useToast();
const catalogStore = useCatalog();

const catalog = ref(null);
const customers = ref([]);
const loading = ref(true);
const loadError = ref('');
const customerBusy = ref(false);
const custQuery = ref('');
const customer = ref(null); // { id?, name, phone }
const custPhone = ref('');
const express = ref(false);
const lines = ref([]); // [{ serviceId, variantId, qty, addons: [addonServiceId] }]
const preview = ref(null);
const previewBusy = ref(false);
const sentOrder = ref(null);
const busy = ref(false);
const historical = ref(false);
const historyForm = ref({
  order_date: new Date().toLocaleDateString('sv-SE'),
  fulfilled_date: new Date().toLocaleDateString('sv-SE'),
  handoff_type: 'pickup', collected_by_name: '',
  payment_method: 'mpesa_manual', payment_amount: 0, payment_ref: '',
});

const svcId = ref('');
const variantId = ref('');
const qty = ref(7);
const pickedAddons = ref([]);

const services = computed(() => catalog.value?.services || []);
const svc = computed(() => services.value.find((service) => service.id === svcId.value));
const qtyLabel = computed(() =>
  svc.value?.pricingModel === 'PER_KG' || svc.value?.unit === 'kg' ? 'Weight (kg)'
  : svc.value?.pricingModel === 'FLAT' ? 'Bags' : 'Quantity');
const addonOptions = computed(() =>
  (svc.value?.addonRules || []).map((rule) => {
    const addon = services.value.find((item) => item.id === rule.addonServiceId);
    return addon && { rule, addon, effRate: rule.overrideRateCents ?? addon.baseRateCents };
  }).filter(Boolean));
const serviceGroups = computed(() => {
  const categories = catalog.value?.categories || [];
  const groups = categories.map((category) => ({
    id: category.id,
    name: category.name,
    services: services.value.filter((service) => service.categoryId === category.id),
  })).filter((group) => group.services.length);
  const groupedIds = new Set(groups.flatMap((group) => group.services.map((service) => service.id)));
  const uncategorized = services.value.filter((service) => !groupedIds.has(service.id));
  if (uncategorized.length) groups.push({ id: 'other', name: 'Other', services: uncategorized });
  return groups;
});
const customerItems = computed(() =>
  customers.value.map((item) => ({ id: item.id, label: item.name, sub: item.phone })));
const orderReady = computed(() => lines.value.length > 0 && customer.value?.name
  && (customer.value.id || custPhone.value.trim()));

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const [catalogData, customerPage] = await Promise.all([
      catalogStore.load(),
      api.get('/customers?limit=8&offset=0'),
    ]);
    catalog.value = catalogData;
    customers.value = customerPage.rows;
    svcId.value = catalogData.services[0]?.id || '';
  } catch (error) {
    loadError.value = error.message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

watch(svcId, () => {
  variantId.value = svc.value?.variants?.[0]?.id || '';
  pickedAddons.value = [];
  qty.value = svc.value?.unit === 'kg' ? 7 : 1;
});

let customerTimer;
watch(custQuery, (query) => {
  if (customer.value?.id && query === customer.value.name) return;
  if (customer.value?.id) {
    customer.value = null;
    custPhone.value = '';
  }
  clearTimeout(customerTimer);
  customerBusy.value = true;
  customerTimer = setTimeout(async () => {
    try {
      const params = new URLSearchParams({ q: query.trim(), limit: '8', offset: '0' });
      const page = await api.get(`/customers?${params}`);
      customers.value = page.rows;
    } catch (error) {
      toast.error(error.message);
    } finally {
      customerBusy.value = false;
    }
  }, 220);
});
onBeforeUnmount(() => clearTimeout(customerTimer));

function pickCustomer(item) {
  const selected = customers.value.find((entry) => entry.id === item.id);
  customer.value = { id: selected.id, name: selected.name, phone: selected.phone };
  custQuery.value = selected.name;
  custPhone.value = selected.phone;
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

function removeLine(index) {
  lines.value.splice(index, 1);
  refreshPreview();
}

let previewRequest = 0;
async function refreshPreview() {
  const request = ++previewRequest;
  if (!lines.value.length) {
    preview.value = null;
    previewBusy.value = false;
    return;
  }
  previewBusy.value = true;
  try {
    const result = await api.post('/orders/preview', { express: express.value, items: lines.value });
    if (request === previewRequest) preview.value = result;
  } catch (error) {
    if (request === previewRequest) toast.error(error.message);
  } finally {
    if (request === previewRequest) previewBusy.value = false;
  }
}
watch(express, refreshPreview);

async function sendQuote() {
  if (!lines.value.length) { toast.error('Add at least one service first'); return; }
  if (!customer.value?.name) { toast.error('Select or add a customer first'); return; }
  if (!(customer.value.id || custPhone.value.trim())) {
    toast.error('Add a phone number so the customer can receive the quote');
    return;
  }
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
      : `Order ${sentOrder.value.code} created — quote sent to the customer`);
  } catch (error) {
    toast.error(error.message);
  } finally {
    busy.value = false;
  }
}

function resetOrder() {
  lines.value = [];
  preview.value = null;
  sentOrder.value = null;
  customer.value = null;
  custQuery.value = '';
  custPhone.value = '';
  express.value = false;
  pickedAddons.value = [];
}
</script>

<template>
  <div>
    <div class="section-head order-head">
      <div>
        <h2>New order</h2>
        <p>Select a customer, add their services, then review and create the order.</p>
      </div>
      <label v-if="session.can('finance.manage')" class="historical-toggle">
        <ToggleSwitch v-model="historical" />
        <span><b>Historical order</b><small>Record an order already fulfilled</small></span>
      </label>
    </div>

    <Panel v-if="historical" title="Historical accounting details" subtitle="Admin only · dates determine the accounting month">
      <div class="history-grid">
        <FormField label="Order date"><DatePicker v-model="historyForm.order_date" /></FormField>
        <FormField label="Fulfilled / revenue date"><DatePicker v-model="historyForm.fulfilled_date" /></FormField>
        <FormField label="Handoff"><AppSelect v-model="historyForm.handoff_type"><option value="pickup">Picked up</option><option value="delivery">Delivered</option></AppSelect></FormField>
        <FormField label="Collected / delivered by"><input v-model="historyForm.collected_by_name" type="text" placeholder="Defaults to customer" /></FormField>
        <FormField label="Payment method"><AppSelect v-model="historyForm.payment_method"><option value="mpesa_manual">Manual M-Pesa</option><option value="cash">Cash</option></AppSelect></FormField>
        <FormField :label="`Payment amount (${session.currency})`"><input v-model.number="historyForm.payment_amount" type="number" min="0" /></FormField>
        <FormField v-if="historyForm.payment_method === 'mpesa_manual' && historyForm.payment_amount > 0" label="M-Pesa code"><input v-model="historyForm.payment_ref" type="text" /></FormField>
      </div>
    </Panel>

    <div v-if="loading" class="loading-grid">
      <Skeleton variant="block" height="210px" />
      <Skeleton variant="block" height="320px" />
    </div>

    <Panel v-else-if="loadError">
      <EmptyState icon="alert" title="New order could not load" :hint="loadError">
        <BaseButton size="sm" icon="refresh" @click="load">Try again</BaseButton>
      </EmptyState>
    </Panel>

    <Panel v-else-if="!services.length">
      <EmptyState icon="builder" title="No active services" hint="Add at least one service in Service Builder before creating an order.">
        <router-link class="btn btn-primary btn-sm" :to="{ name: 'builder' }">Open Service Builder</router-link>
      </EmptyState>
    </Panel>

    <div v-else-if="sentOrder" class="success-wrap">
      <Panel>
        <div class="success-state">
          <span class="success-icon"><AppIcon name="checkCircle" :size="30" /></span>
          <div>
            <small>{{ historical ? 'Historical order recorded' : 'Order created and quote sent' }}</small>
            <h3>{{ sentOrder.code }}</h3>
            <p>{{ sentOrder.customer.name }} · {{ money(sentOrder.totalCents, session.currency) }}</p>
          </div>
          <div class="success-actions">
            <router-link class="btn btn-ghost" :to="{ name: 'orders' }"><AppIcon name="orders" :size="14" /> View orders</router-link>
            <BaseButton icon="plus" @click="resetOrder">Start another order</BaseButton>
          </div>
        </div>
      </Panel>
    </div>

    <div v-else class="order-layout">
      <div class="order-main">
        <Panel title="1. Customer" subtitle="Select an existing customer or add a new one">
          <div class="customer-grid">
            <FormField label="Customer">
              <ComboBox v-model="custQuery" :items="customerItems" :loading="customerBusy"
                placeholder="Search by name or phone…" @select="pickCustomer" @create="newCustomer" />
            </FormField>
            <FormField label="Phone" :hint="customer?.id ? 'Saved customer number' : 'Required for the quote notification'">
              <input v-model="custPhone" type="tel" placeholder="07xx xxx xxx" :disabled="!!customer?.id" />
            </FormField>
          </div>
          <div v-if="customer?.name" class="selection-note">
            <AppIcon :name="customer.id ? 'checkCircle' : 'plus'" :size="15" />
            <span><b>{{ customer.name }}</b>{{ customer.id ? ' selected' : ' will be added with this order' }}</span>
          </div>
        </Panel>

        <Panel title="2. Services" subtitle="Add one or more services to this order">
          <div class="service-grid">
            <FormField label="Service">
              <AppSelect v-model="svcId">
                <optgroup v-for="group in serviceGroups" :key="group.id" :label="group.name">
                  <option v-for="service in group.services" :key="service.id" :value="service.id">
                    {{ service.name }} · {{ service.pricingModel === 'FLAT' ? money(service.baseRateCents, session.currency) : `${money(service.baseRateCents, session.currency)}/${service.unit}` }}
                  </option>
                </optgroup>
              </AppSelect>
            </FormField>
            <FormField v-if="svc?.variants?.length" label="Option">
              <AppSelect v-model="variantId">
                <option v-for="variant in svc.variants" :key="variant.id" :value="variant.id">{{ variant.label }} · {{ money(variant.priceCents, session.currency) }}</option>
              </AppSelect>
            </FormField>
            <FormField :label="qtyLabel">
              <input v-model.number="qty" type="number" min="0.5" step="0.5" />
            </FormField>
          </div>

          <div class="express-row">
            <span class="express-icon"><AppIcon name="clock" :size="17" /></span>
            <span><b>Same-day express</b><small>A surcharge is calculated automatically</small></span>
            <ToggleSwitch v-model="express" />
          </div>

          <div v-if="addonOptions.length" class="addons">
            <div class="addons-head"><label class="field-label">Optional add-ons</label><span>{{ addonOptions.length }} available</span></div>
            <div class="rider-grid">
              <label v-for="option in addonOptions" :key="option.addon.id" class="addon-check"
                :class="{ selected: pickedAddons.includes(option.addon.id) }">
                <input v-model="pickedAddons" type="checkbox" :value="option.addon.id" />
                <span class="rider-copy"><b>{{ option.addon.name }}</b><small>{{ money(option.effRate, session.currency) }}/{{ option.addon.unit }}</small></span>
                <span class="rider-meta"><em v-if="option.rule.overrideRateCents != null">bundled</em><em v-if="option.rule.inheritQty">uses same quantity</em></span>
              </label>
            </div>
          </div>

          <BaseButton icon="plus" :disabled="!svc" @click="addLine">Add service</BaseButton>
        </Panel>
      </div>

      <aside class="order-review">
        <Panel title="3. Review order" :subtitle="`${preview?.lines?.length || 0} service${preview?.lines?.length === 1 ? '' : 's'} added`">
          <div v-if="previewBusy && !preview" class="review-loading"><Skeleton variant="list" :count="2" /></div>
          <EmptyState v-else-if="!preview?.lines?.length" icon="orders" title="No services added" hint="Choose a service and add it to build the order." />
          <template v-else>
            <div class="review-customer">
              <AppIcon name="user" :size="15" />
              <span v-if="customer?.name"><b>{{ customer.name }}</b><small>{{ custPhone || 'Phone required' }}</small></span>
              <span v-else><b>No customer selected</b><small>Complete step 1 before creating the order</small></span>
            </div>
            <div v-for="(line, index) in preview.lines" :key="`${line.serviceId}-${index}`" class="lineitem">
              <div class="li-head"><span>{{ line.serviceName }}<template v-if="line.variantLabel"> · {{ line.variantLabel }}</template></span><span>{{ money(line.lineTotalCents, session.currency) }}</span></div>
              <div class="li-sub">
                <span>{{ line.qty }} {{ line.unit }} × {{ money(line.unitPriceCents, session.currency) }}<b v-if="line.minApplied"> · minimum applied</b></span>
                <button class="remove-line" :aria-label="`Remove ${line.serviceName}`" @click="removeLine(index)"><AppIcon name="trash" :size="13" /></button>
              </div>
              <span v-for="(addon, addonIndex) in line.addons" :key="addonIndex" class="addon-chip">
                {{ addon.addonName }} · {{ addon.qty }} {{ addon.unit }} · {{ money(addon.totalCents, session.currency) }}
              </span>
            </div>
            <div class="totals" :class="{ recalculating: previewBusy }">
              <div class="tr"><span>Subtotal</span><span>{{ money(preview.subtotalCents, session.currency) }}</span></div>
              <div v-if="preview.expressCents" class="tr"><span>Express surcharge</span><span>{{ money(preview.expressCents, session.currency) }}</span></div>
              <div class="tr grand"><span>Total</span><span>{{ money(preview.totalCents, session.currency) }}</span></div>
            </div>
            <p class="snapshot-note"><AppIcon name="shield" :size="13" /> Price locks when the customer confirms the quote.</p>
          </template>

          <div class="review-actions">
            <BaseButton variant="green" icon="send" :loading="busy" :disabled="!orderReady || previewBusy" block @click="sendQuote">
              {{ historical ? 'Record fulfilled order' : 'Create order and send quote' }}
            </BaseButton>
            <BaseButton v-if="lines.length || customer" variant="text" size="sm" @click="resetOrder">Clear draft</BaseButton>
          </div>
        </Panel>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.order-head { align-items: flex-start; }
.historical-toggle { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 10px; background: #fff; cursor: pointer; }
.historical-toggle b, .historical-toggle small { display: block; }
.historical-toggle b { font-size: 11.5px; }
.historical-toggle small { color: var(--muted); font-size: 9.5px; }
.history-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 9px; }
.loading-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(300px, .8fr); gap: 14px; }
.order-layout { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(320px, .8fr); gap: 14px; align-items: start; }
.order-main { min-width: 0; }
.order-review { position: sticky; top: 78px; min-width: 0; }
.customer-grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(190px, 1fr); gap: 10px; }
.selection-note { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding: 7px 9px; border-radius: 8px; background: var(--brand-light); color: var(--brand-dark); font-size: 11px; }
.service-grid { display: grid; grid-template-columns: minmax(220px, 1.6fr) minmax(140px, 1fr) minmax(100px, .55fr); gap: 10px; }
.express-row { display: flex; align-items: center; gap: 9px; margin: 12px 0; padding: 9px 10px; border: 1px solid var(--line); border-radius: 9px; background: #f8fbfa; }
.express-row > span:nth-child(2) { flex: 1; }
.express-row b, .express-row small { display: block; }
.express-row b { font-size: 11.5px; }
.express-row small { color: var(--muted); font-size: 9.5px; }
.express-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; color: var(--brand); background: var(--brand-light); }
.addons { margin-bottom: 12px; }
.addons-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.addons-head .field-label { margin: 0; }
.addons-head > span { color: var(--brand); font-size: 9.5px; font-weight: 700; }
.rider-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; margin-top: 7px; }
.addon-check { min-height: 48px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 7px 9px; border: 1px solid var(--line); border-radius: 9px; background: #fff; cursor: pointer; }
.addon-check:hover { border-color: #b9d8d3; }
.addon-check.selected { border-color: var(--brand); background: var(--brand-light); }
.addon-check input { width: auto; }
.rider-copy { min-width: 0; }
.rider-copy b, .rider-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rider-copy b { font-size: 11.5px; }
.rider-copy small { color: var(--muted); font-size: 9.5px; }
.rider-meta { display: flex; flex-direction: column; gap: 2px; align-items: flex-end; }
.rider-meta em { color: var(--brand-dark); background: #fff; border-radius: 999px; padding: 1px 6px; font-size: 8.5px; font-style: normal; white-space: nowrap; }
.review-loading { padding: 8px 0; }
.review-customer { display: flex; align-items: center; gap: 8px; padding: 8px 9px; margin-bottom: 10px; border-radius: 9px; background: #f3f7f6; color: var(--brand-dark); }
.review-customer b, .review-customer small { display: block; }
.review-customer b { font-size: 11.5px; }
.review-customer small { color: var(--muted); font-size: 9.5px; }
.lineitem .li-head { gap: 8px; }
.lineitem .li-head span:first-child { min-width: 0; }
.lineitem .li-head span:last-child { white-space: nowrap; }
.lineitem .li-sub { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.remove-line { display: grid; place-items: center; flex: 0 0 auto; width: 26px; height: 26px; border: 0; border-radius: 7px; background: transparent; color: var(--muted); cursor: pointer; }
.remove-line:hover { color: var(--red); background: #fdf1f0; }
.totals { transition: opacity .15s ease; }
.totals.recalculating { opacity: .55; }
.snapshot-note { display: flex; align-items: center; gap: 5px; margin-top: 8px; color: var(--muted); font-size: 10px; }
.review-actions { display: flex; flex-direction: column; align-items: center; gap: 3px; margin-top: 13px; }
.success-wrap { max-width: 760px; margin: 36px auto 0; }
.success-state { display: flex; align-items: center; gap: 14px; }
.success-icon { display: grid; place-items: center; flex: 0 0 auto; width: 52px; height: 52px; border-radius: 14px; background: var(--brand-light); color: var(--green); }
.success-state small { color: var(--muted); font-size: 10px; }
.success-state h3 { margin: 0; font: 800 22px var(--font-ui); color: var(--brand-dark); }
.success-state p { color: var(--muted); font-size: 12px; }
.success-actions { display: flex; gap: 8px; margin-left: auto; }

@media (max-width: 1100px) {
  .order-layout, .loading-grid { grid-template-columns: minmax(0, 1.2fr) minmax(300px, .8fr); }
  .rider-grid { grid-template-columns: 1fr; }
}
@media (max-width: 820px) {
  .history-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .order-layout, .loading-grid { grid-template-columns: 1fr; }
  .order-review { position: static; }
  .rider-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .historical-toggle { width: 100%; }
  .customer-grid, .service-grid, .history-grid { grid-template-columns: 1fr; }
  .rider-grid { grid-template-columns: 1fr; }
  .success-state { align-items: flex-start; flex-wrap: wrap; }
  .success-actions { width: 100%; margin-left: 0; flex-direction: column; }
  .success-actions .btn { justify-content: center; }
}
</style>
