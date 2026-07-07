<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { useCatalog } from '../stores/catalog.js';
import { money } from '../utils/format.js';
import Panel from '../components/Panel.vue';
import FormField from '../components/FormField.vue';
import AppIcon from '../components/AppIcon.vue';
import ToggleSwitch from '../components/ToggleSwitch.vue';
import Modal from '../components/Modal.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const session = useSession();
const toast = useToast();

const catalog = ref({ categories: [], services: [] });
const selectedId = ref(null); // null = new service
const busy = ref(false);
const previewQty = ref(7);

const MODELS = [
  { key: 'PER_KG', label: 'Per KG', icon: 'scale' },
  { key: 'PER_ITEM', label: 'Per Item', icon: 'shirt' },
  { key: 'FLAT', label: 'Flat', icon: 'box' },
  { key: 'TIERED', label: 'Tiered', icon: 'tiers' },
];

const blank = () => ({
  name: '', category_id: '', pricing_model: 'PER_KG',
  base_rate: 0, min_charge: 0, express_pct: 50, active: 1,
  variants: [], tiers: [],
  attach: {}, // parentServiceId -> { on, override (KES or ''), inherit }
});
const form = ref(blank());

const catalogStore = useCatalog();
async function load(keepSelection = true) {
  try {
    catalog.value = await catalogStore.load(true);
    if (!keepSelection || !selectedId.value) {
      selectedId.value = catalog.value.services[0]?.id ?? null;
    }
    if (selectedId.value) fillForm(selectedId.value);
    else startNew();
  } catch (e) { toast.error(e.message); }
}
onMounted(() => load(false));

const activeServices = computed(() => catalog.value.services.filter((s) => s.active));
const attachParents = computed(() =>
  activeServices.value.filter((s) => s.id !== selectedId.value));
const riderParentCount = computed(() =>
  Object.values(form.value.attach).filter((a) => a.on).length);

function fillForm(id) {
  const s = catalog.value.services.find((x) => x.id === id);
  if (!s) return;
  selectedId.value = id;
  const attach = {};
  for (const p of catalog.value.services) {
    const rule = s.attachableTo.find((r) => r.parentServiceId === p.id);
    attach[p.id] = rule
      ? { on: true, override: rule.overrideRateCents != null ? rule.overrideRateCents / 100 : '', inherit: !!rule.inheritQty }
      : { on: false, override: '', inherit: true };
  }
  form.value = {
    name: s.name, category_id: s.categoryId, pricing_model: s.pricingModel,
    base_rate: s.baseRateCents / 100, min_charge: s.minChargeCents / 100,
    express_pct: s.expressPct, active: s.active,
    variants: s.variants.map((v) => ({ label: v.label, price: v.priceCents / 100 })),
    tiers: s.tiers.map((t) => ({
      min_qty: t.minQty, max_qty: t.maxQty ?? '',
      rate: t.rateCents != null ? t.rateCents / 100 : '',
      band_price: t.bandPriceCents != null ? t.bandPriceCents / 100 : '',
    })),
    attach,
  };
}

function startNew() {
  selectedId.value = null;
  form.value = blank();
  form.value.category_id = catalog.value.categories[0]?.id || '';
  for (const p of catalog.value.services) form.value.attach[p.id] = { on: false, override: '', inherit: true };
}

const rateLabel = computed(() =>
  form.value.pricing_model === 'PER_KG' ? `Rate (${session.currency}/kg)`
  : form.value.pricing_model === 'PER_ITEM' ? `Base price (${session.currency}/item)`
  : form.value.pricing_model === 'TIERED' ? `Fallback rate (${session.currency})`
  : `Price (${session.currency})`);

// live preview mirrors the server pricing engine
const preview = computed(() => {
  const f = form.value;
  const qty = previewQty.value || 1;
  let unit = f.pricing_model === 'PER_KG' ? 'kg' : f.pricing_model === 'PER_ITEM' ? 'items' : 'order';
  let amount;
  if (f.pricing_model === 'FLAT') amount = f.base_rate;
  else if (f.pricing_model === 'TIERED') {
    const band = f.tiers.find((t) => qty >= (+t.min_qty || 0) && (t.max_qty === '' || qty <= +t.max_qty));
    amount = band ? (band.band_price !== '' ? +band.band_price : (+band.rate || f.base_rate) * qty) : f.base_rate * qty;
  } else {
    let rate = f.base_rate;
    if (f.pricing_model === 'PER_KG') {
      const tier = f.tiers.find((t) => qty >= (+t.min_qty || 0) && (t.max_qty === '' || qty <= +t.max_qty) && t.rate !== '');
      if (tier) rate = +tier.rate;
    }
    amount = rate * qty;
  }
  const minHit = f.min_charge > 0 && amount < f.min_charge;
  if (minHit) amount = f.min_charge;
  const overrides = Object.values(f.attach).filter((a) => a.on && a.override !== '');
  return { amount, minHit, unit, qty, express: amount * (1 + (f.express_pct || 0) / 100), bundled: overrides[0] ? +overrides[0].override * (f.pricing_model === 'FLAT' ? 1 : qty) : null };
});

async function save() {
  const f = form.value;
  if (!f.name.trim()) { toast.error('Service name is required'); return; }
  busy.value = true;
  try {
    const payload = {
      name: f.name, category_id: f.category_id, pricing_model: f.pricing_model,
      base_rate_cents: Math.round(f.base_rate * 100),
      min_charge_cents: Math.round(f.min_charge * 100),
      express_pct: f.express_pct, active: f.active,
      variants: f.variants.filter((v) => v.label.trim()).map((v) => ({ label: v.label, price_cents: Math.round(v.price * 100) })),
      tiers: f.tiers.filter((t) => t.min_qty !== '').map((t) => ({
        min_qty: +t.min_qty, max_qty: t.max_qty === '' ? null : +t.max_qty,
        rate_cents: t.rate === '' ? null : Math.round(+t.rate * 100),
        band_price_cents: t.band_price === '' ? null : Math.round(+t.band_price * 100),
      })),
      attach_to: Object.entries(f.attach).filter(([, a]) => a.on).map(([pid, a]) => ({
        parent_service_id: pid,
        override_rate_cents: a.override === '' ? null : Math.round(+a.override * 100),
        inherit_qty: a.inherit,
      })),
    };
    if (selectedId.value) {
      await api.put(`/services/${selectedId.value}`, payload);
    } else {
      const { id } = await api.post('/services', payload);
      selectedId.value = id;
    }
    catalogStore.invalidate();
    toast.success('Saved ✔ — live for new orders. Existing orders keep their price snapshots.');
    await load();
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}

const retireOpen = ref(false);
async function retire() {
  if (!selectedId.value) return;
  busy.value = true;
  try {
    await api.delete(`/services/${selectedId.value}`);
    catalogStore.invalidate();
    toast.success('Service retired');
    retireOpen.value = false;
    selectedId.value = null;
    await load(false);
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}

const catModal = ref({ open: false, name: '', error: '' });
async function addCategory() {
  const name = catModal.value.name.trim();
  if (!name) { catModal.value.error = 'Give the category a name'; return; }
  busy.value = true;
  try {
    const cat = await api.post('/categories', { name });
    catalog.value.categories.push(cat);
    form.value.category_id = cat.id;
    catalogStore.invalidate();
    catModal.value = { open: false, name: '', error: '' };
    toast.success(`Category “${name}” added`);
  } catch (e) { catModal.value.error = e.message; }
  finally { busy.value = false; }
}
</script>

<template>
  <div>
    <div class="section-head">
      <div>
        <h2>Service &amp; Pricing Builder</h2>
        <p>Admin only · Changes apply to new orders — existing orders keep their price snapshot</p>
      </div>
    </div>

    <div class="split">
      <div>
        <div
          v-for="s in catalog.services" :key="s.id"
          class="sel-item" :class="{ sel: s.id === selectedId }"
          @click="fillForm(s.id)"
        >
          {{ s.name }}
          <span class="sp">{{ s.pricingModel }}<template v-if="!s.active"> · retired</template></span>
        </div>
        <button class="btn btn-ghost" style="width: 100%;" @click="startNew">
          <AppIcon name="plus" :size="14" /> New service
        </button>
      </div>

      <Panel :title="selectedId ? 'Edit service' : 'New service'">
        <div class="row">
          <FormField label="Service name"><input v-model="form.name" type="text" /></FormField>
          <FormField label="Category">
            <select v-model="form.category_id">
              <option v-for="c in catalog.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </FormField>
          <div style="max-width: 120px; align-self: flex-end;">
            <button class="btn btn-ghost btn-sm" @click="catModal = { open: true, name: '', error: '' }">＋ Category</button>
          </div>
        </div>

        <label class="field-label">Pricing model</label>
        <div class="radio-cards">
          <div
            v-for="m in MODELS" :key="m.key"
            :class="{ sel: form.pricing_model === m.key }"
            @click="form.pricing_model = m.key"
          ><AppIcon :name="m.icon" :size="15" /> {{ m.label }}<span v-if="form.pricing_model === m.key" class="model-check"><AppIcon name="check" :size="11" /></span></div>
        </div>

        <div class="row">
          <FormField :label="rateLabel"><input v-model.number="form.base_rate" type="number" min="0" /></FormField>
          <FormField :label="`Minimum charge (${session.currency})`"><input v-model.number="form.min_charge" type="number" min="0" /></FormField>
          <FormField label="Express surcharge %"><input v-model.number="form.express_pct" type="number" min="0" /></FormField>
        </div>

        <template v-if="form.pricing_model === 'PER_ITEM'">
          <label class="field-label">Variants (e.g. duvet sizes) — leave empty to use base price</label>
          <div v-for="(v, i) in form.variants" :key="i" class="row tight">
            <FormField label="Label"><input v-model="v.label" type="text" placeholder="e.g. King" /></FormField>
            <FormField :label="`Price (${session.currency})`"><input v-model.number="v.price" type="number" min="0" /></FormField>
            <div class="rm"><button class="btn btn-danger btn-sm" @click="form.variants.splice(i, 1)">✕</button></div>
          </div>
          <button class="btn btn-ghost btn-sm" @click="form.variants.push({ label: '', price: 0 })">＋ Add variant</button>
        </template>

        <template v-if="form.pricing_model === 'PER_KG' || form.pricing_model === 'TIERED'">
          <label class="field-label" style="margin-top: 12px;">
            {{ form.pricing_model === 'PER_KG' ? 'Volume rate breaks (optional): from qty → new rate/kg' : 'Bands: qty range → band price (flat) or rate' }}
          </label>
          <div v-for="(t, i) in form.tiers" :key="i" class="row tight">
            <FormField label="From qty"><input v-model.number="t.min_qty" type="number" min="0" step="0.5" /></FormField>
            <FormField label="To qty (blank = ∞)"><input v-model="t.max_qty" type="number" min="0" step="0.5" /></FormField>
            <FormField v-if="form.pricing_model === 'PER_KG'" :label="`Rate (${session.currency}/kg)`"><input v-model="t.rate" type="number" min="0" /></FormField>
            <template v-else>
              <FormField :label="`Band price (${session.currency})`"><input v-model="t.band_price" type="number" min="0" /></FormField>
            </template>
            <div class="rm"><button class="btn btn-danger btn-sm" @click="form.tiers.splice(i, 1)">✕</button></div>
          </div>
          <button class="btn btn-ghost btn-sm" @click="form.tiers.push({ min_qty: 0, max_qty: '', rate: '', band_price: '' })">＋ Add {{ form.pricing_model === 'PER_KG' ? 'rate break' : 'band' }}</button>
        </template>

        <div class="rider-heading">
          <label class="field-label">Can attach as a rider to</label>
          <span>{{ riderParentCount }} selected</span>
        </div>
        <div v-for="p in attachParents" :key="p.id" class="attach-row">
          <label class="attach-check">
            <input v-model="form.attach[p.id].on" type="checkbox" /> {{ p.name }}
          </label>
          <template v-if="form.attach[p.id].on">
            <input v-model="form.attach[p.id].override" type="number" min="0"
              class="ov-input" :placeholder="`bundled rate (blank = standalone)`" />
            <label class="attach-check small">
              <input v-model="form.attach[p.id].inherit" type="checkbox" /> inherits qty
            </label>
          </template>
        </div>

        <div class="row" style="margin-top: 12px;">
          <FormField label="Preview qty"><input v-model.number="previewQty" type="number" min="0.5" step="0.5" /></FormField>
          <div style="flex: 2;">
            <div class="preview-box">
              <div>Standalone · {{ preview.qty }} {{ preview.unit }}</div>
              <div class="big">{{ money(preview.amount * 100, session.currency) }}</div>
              <div v-if="preview.minHit" class="warn">minimum charge applied</div>
              <div v-if="preview.bundled != null" style="margin-top: 6px;">As a rider (bundled): <b class="teal">{{ money(preview.bundled * 100, session.currency) }}</b></div>
              <div v-if="form.express_pct" class="small" style="margin-top: 6px;">With express +{{ form.express_pct }}%: {{ money(preview.express * 100, session.currency) }}</div>
            </div>
          </div>
        </div>

        <div class="actions">
          <button class="btn btn-primary" :disabled="busy" @click="save">Save service</button>
          <button v-if="selectedId && form.active" class="btn btn-danger" :disabled="busy" @click="retireOpen = true">Retire service</button>
        </div>
      </Panel>
    </div>

    <Modal v-if="catModal.open" title="New category" @close="catModal.open = false">
      <FormField label="Category name" :error="catModal.error"
        hint="Groups services in the builder, on the order screen, and in reports">
        <input v-model="catModal.name" type="text" placeholder="e.g. Curtains & Drapes" @keyup.enter="addCategory" />
      </FormField>
      <template #footer>
        <button class="btn btn-ghost" @click="catModal.open = false">Cancel</button>
        <button class="btn btn-primary" :disabled="busy" @click="addCategory">Add category</button>
      </template>
    </Modal>

    <ConfirmDialog v-if="retireOpen" danger :busy="busy"
      :title="`Retire “${form.name}”?`"
      message="It stops being sellable immediately. Existing orders keep their price snapshots, and you can rebuild it later."
      confirm-label="Retire service"
      @confirm="retire" @close="retireOpen = false" />
  </div>
</template>

<style scoped>
.row.tight { margin-bottom: 6px; align-items: flex-end; }
.rm { flex: 0 0 auto; min-width: 0 !important; align-self: flex-end; }
.attach-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; flex-wrap: wrap; }
.rider-heading { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 14px; }
.rider-heading .field-label { margin: 0; }
.rider-heading span { color: var(--brand); background: var(--brand-light); border-radius: 999px; padding: 2px 8px; font-size: 9.5px; font-weight: 700; }
.model-check { margin-left: auto; width: 18px; height: 18px; display: grid; place-items: center; border-radius: 50%; background: var(--brand); color: #fff; }
.attach-check { display: flex; align-items: center; gap: 7px; font-size: 13px; }
.attach-check input { width: auto; }
.ov-input { max-width: 210px; }
.warn { color: #fbbf24; font-size: 11.5px; }
.teal { color: #7ed7c9; }
.actions { display: flex; gap: 10px; margin-top: 14px; }
</style>
