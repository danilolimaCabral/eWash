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
const riderOpen = ref(false); // add-on section starts collapsed unless the service has riders

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
  riderOpen.value = Object.values(attach).some((a) => a.on);
}

function startNew() {
  selectedId.value = null;
  form.value = blank();
  form.value.category_id = catalog.value.categories[0]?.id || '';
  for (const p of catalog.value.services) form.value.attach[p.id] = { on: false, override: '', inherit: true };
  riderOpen.value = false;
}

const rateLabel = computed(() =>
  form.value.pricing_model === 'PER_KG' ? `Price per kg (${session.currency})`
  : form.value.pricing_model === 'PER_ITEM' ? `Price per item (${session.currency})`
  : form.value.pricing_model === 'TIERED' ? `Default price (${session.currency})`
  : `Price (${session.currency})`);
const rateHint = computed(() =>
  form.value.pricing_model === 'TIERED' ? 'Used when the quantity falls outside every range below' : '');

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

      <Panel :title="selectedId ? 'Editar serviço' : 'New service'">
        <section class="sect first">
          <div class="sect-head">
            <h4><span class="sect-num">1</span> Basics</h4>
            <button class="btn btn-ghost btn-sm push-right" @click="catModal = { open: true, name: '', error: '' }">
              <AppIcon name="plus" :size="12" /> Category
            </button>
          </div>
          <div class="row">
            <FormField label="Service name" style="flex: 2;">
              <input v-model="form.name" type="text" placeholder="e.g. Wash &amp; Fold (per kg)" />
            </FormField>
            <FormField label="Category">
              <select v-model="form.category_id">
                <option v-for="c in catalog.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </FormField>
          </div>
        </section>

        <section class="sect">
          <div class="sect-head"><h4><span class="sect-num">2</span> Pricing</h4></div>
          <label class="field-label">How is this service charged?</label>
          <div class="radio-cards">
            <div
              v-for="m in MODELS" :key="m.key"
              :class="{ sel: form.pricing_model === m.key }"
              @click="form.pricing_model = m.key"
            ><AppIcon :name="m.icon" :size="15" /> {{ m.label }}<span v-if="form.pricing_model === m.key" class="model-check"><AppIcon name="check" :size="11" /></span></div>
          </div>

          <div class="row">
            <FormField :label="rateLabel" :hint="rateHint"><input v-model.number="form.base_rate" type="number" min="0" /></FormField>
            <FormField :label="`Minimum charge (${session.currency})`" hint="The least a customer pays"><input v-model.number="form.min_charge" type="number" min="0" /></FormField>
            <FormField label="Express extra charge (%)" hint="Added for same-day / rush orders"><input v-model.number="form.express_pct" type="number" min="0" /></FormField>
          </div>

          <template v-if="form.pricing_model === 'PER_ITEM'">
            <div class="sub-head">
              <span>Sizes &amp; options</span>
              <small>optional — e.g. duvet sizes; leave empty to charge the price per item above</small>
            </div>
            <div v-if="form.variants.length" class="grid-rows cols-2">
              <div class="gr-h">Name</div>
              <div class="gr-h">Price ({{ session.currency }})</div>
              <div class="gr-h" />
              <template v-for="(v, i) in form.variants" :key="i">
                <input v-model="v.label" type="text" placeholder="e.g. King size" :aria-label="`Option ${i + 1} name`" />
                <input v-model.number="v.price" type="number" min="0" :aria-label="`Option ${i + 1} price`" />
                <button class="row-rm" aria-label="Remove option" @click="form.variants.splice(i, 1)"><AppIcon name="x" :size="12" /></button>
              </template>
            </div>
            <button class="btn btn-ghost btn-sm" @click="form.variants.push({ label: '', price: 0 })"><AppIcon name="plus" :size="12" /> Add size / option</button>
          </template>

          <template v-if="form.pricing_model === 'PER_KG' || form.pricing_model === 'TIERED'">
            <div class="sub-head">
              <span>{{ form.pricing_model === 'PER_KG' ? 'Cheaper rate for bigger loads' : 'Price by quantity range' }}</span>
              <small>{{ form.pricing_model === 'PER_KG' ? 'optional — from a certain quantity, a lower price per kg applies' : 'each range gets one fixed price' }}</small>
            </div>
            <div v-if="form.tiers.length" class="grid-rows cols-3">
              <div class="gr-h">From qty</div>
              <div class="gr-h">Up to qty (blank = no limit)</div>
              <div class="gr-h">{{ form.pricing_model === 'PER_KG' ? `New price per kg (${session.currency})` : `Fixed price (${session.currency})` }}</div>
              <div class="gr-h" />
              <template v-for="(t, i) in form.tiers" :key="i">
                <input v-model.number="t.min_qty" type="number" min="0" step="0.5" aria-label="From quantity" />
                <input v-model="t.max_qty" type="number" min="0" step="0.5" aria-label="Up to quantity" />
                <input v-if="form.pricing_model === 'PER_KG'" v-model="t.rate" type="number" min="0" aria-label="New price per kg" />
                <input v-else v-model="t.band_price" type="number" min="0" aria-label="Fixed price for this range" />
                <button class="row-rm" aria-label="Remove range" @click="form.tiers.splice(i, 1)"><AppIcon name="x" :size="12" /></button>
              </template>
            </div>
            <button class="btn btn-ghost btn-sm" @click="form.tiers.push({ min_qty: 0, max_qty: '', rate: '', band_price: '' })"><AppIcon name="plus" :size="12" /> Add {{ form.pricing_model === 'PER_KG' ? 'quantity discount' : 'quantity range' }}</button>
          </template>
        </section>

        <details class="sect sect-details" :open="riderOpen" @toggle="riderOpen = $event.target.open">
          <summary class="sect-head">
            <h4><span class="sect-num">3</span> Attach as an additional service</h4>
            <span class="count-chip">{{ riderParentCount }} selected</span>
            <span class="caret" aria-hidden="true" />
          </summary>
          <p class="sect-hint">
            Let customers add this service on top of another one — e.g. Ironing added to Wash &amp; Fold.
            You can give it a cheaper price when it's added this way.
          </p>
          <div v-for="p in attachParents" :key="p.id" class="attach-row">
            <ToggleSwitch v-model="form.attach[p.id].on" />
            <span class="attach-name" @click="form.attach[p.id].on = !form.attach[p.id].on">{{ p.name }}</span>
            <template v-if="form.attach[p.id].on">
              <input v-model="form.attach[p.id].override" type="number" min="0"
                class="ov-input" placeholder="price when added (blank = normal price)" />
              <label class="attach-check small">
                <input v-model="form.attach[p.id].inherit" type="checkbox" /> use same quantity as the main service
              </label>
            </template>
          </div>
        </details>

        <section class="sect">
          <div class="sect-head"><h4><span class="sect-num">4</span> Price preview</h4></div>
          <div class="preview-box pv">
            <div class="pv-qty">
              <label class="pv-cap" for="pv-qty">Try a quantity</label>
              <input id="pv-qty" v-model.number="previewQty" type="number" min="0.5" step="0.5" />
            </div>
            <div class="pv-main">
              <div class="pv-cap">On its own · {{ preview.qty }} {{ preview.unit }}</div>
              <div class="big">{{ money(preview.amount * 100, session.currency) }}</div>
              <div v-if="preview.minHit" class="warn">minimum charge applied</div>
            </div>
            <div class="pv-extra">
              <div v-if="preview.bundled != null">Added to another service: <b class="teal">{{ money(preview.bundled * 100, session.currency) }}</b></div>
              <div v-if="form.express_pct">With express (+{{ form.express_pct }}%): <b class="teal">{{ money(preview.express * 100, session.currency) }}</b></div>
            </div>
          </div>
        </section>

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
/* numbered sections */
.sect { border-top: 1px dashed var(--line); padding-top: 14px; margin-top: 16px; }
.sect.first { border-top: 0; padding-top: 0; margin-top: 0; }
.sect-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.sect-head h4 {
  margin: 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--muted); display: flex; align-items: center; gap: 8px;
}
.sect-num {
  width: 18px; height: 18px; border-radius: 50%; background: var(--brand-light);
  color: var(--brand-dark); font-size: 10.5px; font-weight: 800; display: grid; place-items: center;
}
.push-right { margin-left: auto; }
.sect-hint { color: var(--muted); font-size: 11.5px; margin: 0 0 8px; }

/* collapsible add-on section */
.sect-details > summary { cursor: pointer; list-style: none; margin-bottom: 0; }
.sect-details[open] > summary { margin-bottom: 8px; }
.sect-details > summary::-webkit-details-marker { display: none; }
.count-chip { color: var(--brand); background: var(--brand-light); border-radius: 999px; padding: 2px 8px; font-size: 9.5px; font-weight: 700; }
.caret {
  margin-left: auto; width: 8px; height: 8px; flex-shrink: 0;
  border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted);
  transform: rotate(45deg); transition: transform 0.15s; margin-top: -4px;
}
.sect-details[open] .caret { transform: rotate(-135deg); margin-top: 4px; }

/* sub-lists inside Pricing (sizes, quantity ranges) */
.sub-head { display: flex; align-items: baseline; gap: 8px; margin: 12px 0 6px; font-size: 12.5px; font-weight: 700; flex-wrap: wrap; }
.sub-head small { color: var(--muted); font-weight: 400; font-size: 11px; }
.grid-rows { display: grid; gap: 6px 8px; align-items: center; margin-bottom: 8px; }
.grid-rows.cols-2 { grid-template-columns: 2fr 1fr 30px; }
.grid-rows.cols-3 { grid-template-columns: 1fr 1fr 1fr 30px; }
.gr-h { font-size: 10px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.4px; }
.row-rm {
  width: 30px; height: 30px; border: 1px solid #f2c4bf; color: var(--red); background: #fff;
  border-radius: 7px; cursor: pointer; display: grid; place-items: center;
}
.row-rm:hover { background: #fdf1f0; }

/* pricing model selected check */
.model-check { margin-left: auto; width: 18px; height: 18px; display: grid; place-items: center; border-radius: 50%; background: var(--brand); color: #fff; }

/* attach rows */
.attach-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; flex-wrap: wrap; }
.attach-row:hover { background: #f6faf9; }
.attach-name { font-size: 13px; cursor: pointer; }
.attach-check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.attach-check input { width: auto; }
.ov-input { max-width: 250px; margin-left: auto; }

/* price preview */
.pv { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
.pv-qty { flex: 0 0 110px; }
.pv-qty input { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.25); color: #e2e8f0; }
.pv-cap { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9fb8b3; margin-bottom: 3px; }
.pv-main { flex: 1; min-width: 150px; }
.pv-extra { font-size: 12.5px; display: flex; flex-direction: column; gap: 4px; text-align: right; }
.warn { color: #fbbf24; font-size: 11.5px; }
.teal { color: #7ed7c9; }
.actions { display: flex; gap: 10px; margin-top: 16px; }

@media (max-width: 640px) {
  .pv-extra { text-align: left; }
  .ov-input { margin-left: 0; max-width: 100%; }
}
</style>
