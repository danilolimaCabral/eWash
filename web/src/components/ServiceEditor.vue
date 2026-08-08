<script setup>
// Shared service-pricing editor used in the desktop workspace and mobile modal.
import { computed, ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import AppSelect from './AppSelect.vue';
import BaseButton from './BaseButton.vue';
import EmptyState from './EmptyState.vue';
import FormField from './FormField.vue';
import Tabs from './Tabs.vue';
import ToggleSwitch from './ToggleSwitch.vue';
import { money } from '../utils/format.js';

const props = defineProps({
  modelValue: { type: Object, required: true },
  serviceId: { type: String, default: null },
  categories: { type: Array, default: () => [] },
  attachParents: { type: Array, default: () => [] },
  currency: { type: String, default: 'KES' },
  preview: { type: Object, required: true },
  previewQty: { type: Number, default: 7 },
  busy: { type: Boolean, default: false },
  dirty: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue', 'update:previewQty', 'save', 'add-category', 'retire']);
const form = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
const tab = ref('overview');
const addonQuery = ref('');

const MODELS = [
  { key: 'PER_KG', label: 'Per kg', hint: 'Quantity × rate', icon: 'scale' },
  { key: 'PER_ITEM', label: 'Per item', hint: 'Each item or size', icon: 'shirt' },
  { key: 'FLAT', label: 'Flat price', hint: 'One price per order', icon: 'box' },
  { key: 'TIERED', label: 'Quantity bands', hint: 'Fixed price per range', icon: 'tiers' },
];
const tabs = computed(() => [
  { key: 'overview', label: 'Overview', icon: 'edit' },
  {
    key: 'rules', label: 'Pricing rules', icon: 'tiers',
    count: form.value.pricing_model === 'PER_ITEM' ? form.value.variants.length : form.value.tiers.length,
  },
  { key: 'addons', label: 'Add-ons', icon: 'plus', count: riderParentCount.value },
]);
const riderParentCount = computed(() => Object.values(form.value.attach).filter((item) => item.on).length);
const filteredParents = computed(() => {
  const query = addonQuery.value.trim().toLowerCase();
  return query ? props.attachParents.filter((service) => service.name.toLowerCase().includes(query)) : props.attachParents;
});
const rateLabel = computed(() =>
  form.value.pricing_model === 'PER_KG' ? `Price per kg (${props.currency})`
  : form.value.pricing_model === 'PER_ITEM' ? `Default item price (${props.currency})`
  : form.value.pricing_model === 'TIERED' ? `Fallback price (${props.currency})`
  : `Order price (${props.currency})`);
const rulesTitle = computed(() => form.value.pricing_model === 'PER_ITEM' ? 'Sizes and item options'
  : form.value.pricing_model === 'PER_KG' ? 'Quantity discounts'
  : form.value.pricing_model === 'TIERED' ? 'Quantity ranges' : 'No additional rules');

watch(() => props.serviceId, () => { tab.value = 'overview'; addonQuery.value = ''; });

function chooseModel(key) {
  form.value.pricing_model = key;
}
function addRule() {
  if (form.value.pricing_model === 'PER_ITEM') form.value.variants.push({ label: '', price: 0 });
  else form.value.tiers.push({ min_qty: 0, max_qty: '', rate: '', band_price: '' });
}
</script>

<template>
  <div class="service-editor">
    <Tabs v-model="tab" :tabs="tabs" />

    <div v-if="tab === 'overview'" class="tab-pane overview-grid">
      <div class="overview-form">
        <section class="editor-section">
          <div class="section-title"><div><h4>Service details</h4><p>Name and group shown during order intake.</p></div></div>
          <div class="field-grid details-grid">
            <FormField label="Service name"><input v-model="form.name" type="text" placeholder="e.g. Wash & Fold" /></FormField>
            <FormField label="Category">
              <AppSelect v-model="form.category_id"><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option></AppSelect>
            </FormField>
          </div>
          <BaseButton variant="text" size="sm" icon="plus" @click="$emit('add-category')">Add category</BaseButton>
        </section>

        <section class="editor-section">
          <div class="section-title"><div><h4>How customers are charged</h4><p>Choose one pricing model, then enter its standard rate.</p></div></div>
          <div class="model-grid">
            <button v-for="model in MODELS" :key="model.key" type="button"
              :class="{ active: form.pricing_model === model.key }" @click="chooseModel(model.key)">
              <span class="model-icon"><AppIcon :name="model.icon" :size="16" /></span>
              <span><b>{{ model.label }}</b><small>{{ model.hint }}</small></span>
              <AppIcon v-if="form.pricing_model === model.key" class="model-check" name="checkCircle" :size="16" />
            </button>
          </div>
          <div class="field-grid price-fields">
            <FormField :label="rateLabel" :hint="form.pricing_model === 'TIERED' ? 'Used outside the ranges you define' : ''"><input v-model.number="form.base_rate" type="number" min="0" /></FormField>
            <FormField :label="`Minimum charge (${currency})`" hint="Optional floor for the calculated price"><input v-model.number="form.min_charge" type="number" min="0" /></FormField>
            <FormField label="Express surcharge (%)" hint="Added to rush and same-day orders"><input v-model.number="form.express_pct" type="number" min="0" /></FormField>
          </div>
        </section>
      </div>

      <aside class="preview-card">
        <div class="preview-head"><span><AppIcon name="chart" :size="16" /></span><div><h4>Live price preview</h4><p>Check the result before saving.</p></div></div>
        <FormField label="Example quantity"><input :value="previewQty" type="number" min="0.5" step="0.5" @input="$emit('update:previewQty', +$event.target.value)" /></FormField>
        <div class="preview-total"><small>Standard price</small><strong>{{ money(preview.amount * 100, currency) }}</strong><span>{{ preview.qty }} {{ preview.unit }}</span></div>
        <div v-if="preview.minHit" class="preview-note warn"><AppIcon name="alert" :size="13" /> Minimum charge applied</div>
        <div v-if="form.express_pct" class="preview-line"><span>With express (+{{ form.express_pct }}%)</span><b>{{ money(preview.express * 100, currency) }}</b></div>
        <div v-if="preview.bundled != null" class="preview-line"><span>As an add-on</span><b>{{ money(preview.bundled * 100, currency) }}</b></div>
      </aside>
    </div>

    <div v-else-if="tab === 'rules'" class="tab-pane">
      <div class="pane-heading"><div><h4>{{ rulesTitle }}</h4><p>Only rules relevant to the selected pricing model are shown.</p></div><BaseButton v-if="form.pricing_model !== 'FLAT'" size="sm" variant="ghost" icon="plus" @click="addRule">Add rule</BaseButton></div>

      <EmptyState v-if="form.pricing_model === 'FLAT'" icon="box" title="Flat-price services need no extra rules" hint="The order price from Overview is used regardless of quantity." />

      <template v-else-if="form.pricing_model === 'PER_ITEM'">
        <EmptyState v-if="!form.variants.length" icon="shirt" title="No item options yet" hint="Add options when sizes or item types have different prices."><BaseButton size="sm" variant="ghost" icon="plus" @click="addRule">Add first option</BaseButton></EmptyState>
        <div v-else class="rule-list">
          <div v-for="(variant, index) in form.variants" :key="index" class="rule-row variant-row">
            <span class="rule-index">{{ index + 1 }}</span>
            <FormField label="Option name"><input v-model="variant.label" type="text" placeholder="e.g. King size" /></FormField>
            <FormField :label="`Price (${currency})`"><input v-model.number="variant.price" type="number" min="0" /></FormField>
            <button class="remove-rule" :aria-label="`Remove option ${index + 1}`" @click="form.variants.splice(index, 1)"><AppIcon name="x" :size="13" /></button>
          </div>
        </div>
      </template>

      <template v-else>
        <EmptyState v-if="!form.tiers.length" icon="tiers" title="No quantity rules yet"
          :hint="form.pricing_model === 'PER_KG' ? 'Add a discounted rate that starts at a chosen weight.' : 'Add fixed-price ranges for different quantities.'">
          <BaseButton size="sm" variant="ghost" icon="plus" @click="addRule">Add first rule</BaseButton>
        </EmptyState>
        <div v-else class="rule-list">
          <div v-for="(tier, index) in form.tiers" :key="index" class="rule-row tier-row">
            <span class="rule-index">{{ index + 1 }}</span>
            <FormField label="From"><input v-model.number="tier.min_qty" type="number" min="0" step="0.5" /></FormField>
            <FormField label="Up to" hint="Blank means no limit"><input v-model="tier.max_qty" type="number" min="0" step="0.5" /></FormField>
            <FormField :label="form.pricing_model === 'PER_KG' ? `Rate / kg (${currency})` : `Fixed price (${currency})`">
              <input v-if="form.pricing_model === 'PER_KG'" v-model="tier.rate" type="number" min="0" />
              <input v-else v-model="tier.band_price" type="number" min="0" />
            </FormField>
            <button class="remove-rule" :aria-label="`Remove rule ${index + 1}`" @click="form.tiers.splice(index, 1)"><AppIcon name="x" :size="13" /></button>
          </div>
        </div>
      </template>
    </div>

    <div v-else class="tab-pane">
      <div class="pane-heading"><div><h4>Available as an add-on</h4><p>Choose which main services can include this one as an extra.</p></div><span class="selection-count">{{ riderParentCount }} selected</span></div>
      <div v-if="attachParents.length" class="addon-search"><AppIcon name="search" :size="14" /><input v-model="addonQuery" type="search" placeholder="Search services…" /></div>
      <EmptyState v-if="!attachParents.length" icon="plus" title="No other active services" hint="Create another service before configuring add-on relationships." />
      <EmptyState v-else-if="!filteredParents.length" icon="search" title="No matching services" hint="Try another search term." />
      <div v-else class="addon-list">
        <div v-for="parent in filteredParents" :key="parent.id" class="addon-row" :class="{ active: form.attach[parent.id].on }">
          <ToggleSwitch v-model="form.attach[parent.id].on" />
          <button class="addon-name" type="button" @click="form.attach[parent.id].on = !form.attach[parent.id].on"><b>{{ parent.name }}</b><small>{{ parent.categoryName || 'Service' }}</small></button>
          <template v-if="form.attach[parent.id].on">
            <FormField :label="`Add-on price (${currency})`" hint="Blank keeps normal price"><input v-model="form.attach[parent.id].override" type="number" min="0" /></FormField>
            <label class="inherit-check"><input v-model="form.attach[parent.id].inherit" type="checkbox" /> Use main service quantity</label>
          </template>
        </div>
      </div>
    </div>

    <footer class="editor-actions">
      <span class="save-state"><i :class="{ dirty }" />{{ dirty ? 'Unsaved changes' : 'All changes saved' }}</span>
      <BaseButton v-if="serviceId && form.active" variant="text" size="sm" @click="$emit('retire')">Remove service</BaseButton>
      <BaseButton :loading="busy" :disabled="!dirty || !form.name.trim() || !form.category_id" @click="$emit('save')">Save service</BaseButton>
    </footer>
  </div>
</template>

<style scoped>
.service-editor { min-height: 0; display: flex; flex-direction: column; }
.tab-pane { min-height: 330px; }.overview-grid { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 14px; align-items: start; }
.overview-form { display: grid; gap: 12px; }.editor-section { padding: 12px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--card); }
.section-title { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 10px; }.section-title h4, .pane-heading h4, .preview-head h4 { font-size: 12.5px; }.section-title p, .pane-heading p, .preview-head p { color: var(--muted); font-size: 10px; }
.field-grid { display: grid; gap: 10px; }.details-grid { grid-template-columns: minmax(0, 1.5fr) minmax(150px, 1fr); }.price-fields { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 11px; }
.model-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.model-grid button { min-width: 0; padding: 8px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--card); color: var(--ink); font-family: inherit; text-align: left; cursor: pointer; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 7px; }
.model-grid button:hover { border-color: #bcd8d4; }.model-grid button.active { border-color: var(--brand); background: var(--brand-light); }
.model-icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--radius-sm); background: var(--surface-muted); color: var(--brand); }.model-grid b, .model-grid small { display: block; line-height: 1.25; }.model-grid b { font-size: 10.5px; }.model-grid small { color: var(--muted); font-size: 8.5px; }.model-check { color: var(--brand); }
.preview-card { padding: 13px; border-radius: var(--radius-md); background: var(--side); color: var(--card); box-shadow: var(--shadow-card); position: sticky; top: 0; }
.preview-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }.preview-head > span { width: 30px; height: 30px; display: grid; place-items: center; border-radius: var(--radius-sm); background: rgba(255,255,255,.1); color: #7ed7c9; }.preview-head h4 { color: var(--card); }.preview-head p { color: #9fb8b3; }
.preview-card :deep(.field-label) { color: #9fb8b3; }.preview-card input { color: var(--card); border-color: rgba(255,255,255,.25); background: rgba(255,255,255,.08); }
.preview-total { padding: 12px 0; margin: 4px 0 8px; border-top: 1px solid rgba(255,255,255,.12); border-bottom: 1px solid rgba(255,255,255,.12); }.preview-total small, .preview-total strong, .preview-total span { display: block; }.preview-total small { color: #9fb8b3; font-size: 9px; text-transform: uppercase; }.preview-total strong { margin: 2px 0; color: #7ed7c9; font-size: 22px; }.preview-total span { color: #c5d3d0; font-size: 10px; }
.preview-line, .preview-note { display: flex; justify-content: space-between; gap: 8px; padding-top: 7px; font-size: 10px; }.preview-line span { color: #9fb8b3; }.preview-line b { color: var(--card); }.preview-note.warn { justify-content: flex-start; align-items: center; color: #fbbf24; }
.pane-heading { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 11px; }.selection-count { padding: 3px 9px; border-radius: var(--radius-pill); background: var(--brand-light); color: var(--brand); font-size: 9.5px; font-weight: 700; white-space: nowrap; }
.rule-list, .addon-list { display: grid; gap: 7px; }.rule-row { display: grid; align-items: start; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-subtle); }.variant-row { grid-template-columns: 24px minmax(0, 2fr) minmax(120px, 1fr) 30px; }.tier-row { grid-template-columns: 24px repeat(3, minmax(100px, 1fr)) 30px; }
.rule-index { width: 22px; height: 22px; display: grid; place-items: center; margin-top: 22px; border-radius: 50%; background: var(--brand-light); color: var(--brand); font-size: 9px; font-weight: 700; }.remove-rule { width: 30px; height: 30px; display: grid; place-items: center; margin-top: 19px; border: 1px solid #f2c4bf; border-radius: var(--radius-sm); background: var(--card); color: var(--red); cursor: pointer; }
.addon-search { position: relative; max-width: 300px; margin-bottom: 10px; }.addon-search svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--muted); }.addon-search input { padding-left: 31px; }
.addon-row { display: grid; grid-template-columns: auto minmax(130px, 1fr); align-items: center; gap: 9px; padding: 9px 10px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--card); }.addon-row.active { grid-template-columns: auto minmax(130px, 1fr) minmax(150px, .8fr) auto; border-color: #bcd8d4; background: var(--surface-subtle); }.addon-name { border: 0; background: none; color: var(--ink); font-family: inherit; text-align: left; cursor: pointer; }.addon-name b, .addon-name small { display: block; }.addon-name b { font-size: 11.5px; }.addon-name small { color: var(--muted); font-size: 9px; }.inherit-check { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 10px; white-space: nowrap; }.inherit-check input { width: auto; }
.editor-actions { position: sticky; bottom: 0; z-index: 4; display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 11px 0 0; margin-top: 14px; border-top: 1px solid var(--line); background: var(--card); }.save-state { display: flex; align-items: center; gap: 6px; margin-right: auto; color: var(--muted); font-size: 9.5px; }.save-state i { width: 7px; height: 7px; border-radius: 50%; background: var(--green); }.save-state i.dirty { background: var(--accent); }
@media (max-width: 760px) {
  .overview-grid { grid-template-columns: 1fr; }.preview-card { position: static; }.model-grid { grid-template-columns: repeat(2, 1fr); }.price-fields { grid-template-columns: 1fr 1fr; }.price-fields :deep(.ff:last-child) { grid-column: 1 / -1; }
  .addon-row.active { grid-template-columns: auto minmax(0, 1fr); }.addon-row.active :deep(.ff), .addon-row.active .inherit-check { grid-column: 2; }
}
@media (max-width: 520px) {
  .details-grid, .price-fields { grid-template-columns: 1fr; }.price-fields :deep(.ff:last-child) { grid-column: auto; }.variant-row, .tier-row { grid-template-columns: 24px minmax(0, 1fr) 30px; }.rule-row :deep(.ff) { grid-column: 2; }.rule-index { grid-row: 1; }.remove-rule { grid-column: 3; grid-row: 1; }.editor-actions { padding-bottom: env(safe-area-inset-bottom); }.save-state { display: none; }
}
</style>
