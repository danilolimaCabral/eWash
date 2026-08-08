<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { useCatalog } from '../stores/catalog.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { money } from '../utils/format.js';
import AppIcon from '../components/AppIcon.vue';
import AppSelect from '../components/AppSelect.vue';
import BaseButton from '../components/BaseButton.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import FormField from '../components/FormField.vue';
import Modal from '../components/Modal.vue';
import Pagination from '../components/Pagination.vue';
import Panel from '../components/Panel.vue';
import ServiceEditor from '../components/ServiceEditor.vue';
import Skeleton from '../components/Skeleton.vue';

const DIRECTORY_LIMIT = 16;
const session = useSession();
const toast = useToast();
const catalogStore = useCatalog();

const catalog = ref({ categories: [], services: [] });
const directory = ref({ rows: [], total: 0, limit: DIRECTORY_LIMIT, offset: 0 });
const directoryLoading = ref(true);
const directoryError = ref('');
const selectedId = ref(null);
const editorOpen = ref(false);
const compact = ref(false);
const busy = ref(false);
const previewQty = ref(7);
const filters = ref({ q: '', category: '', status: 'active' });
const savedSnapshot = ref('');
const pendingAction = ref(null);
const retireOpen = ref(false);
const catModal = ref({ open: false, name: '', error: '' });
let searchTimer;
let mediaQuery;

const blank = () => ({
  name: '', category_id: '', pricing_model: 'PER_KG',
  base_rate: 0, min_charge: 0, express_pct: 50, active: 1,
  variants: [], tiers: [], attach: {},
});
const form = ref(blank());
const snapshot = () => JSON.stringify(form.value);
const dirty = computed(() => snapshot() !== savedSnapshot.value);
const categoryNames = computed(() => new Map(catalog.value.categories.map((category) => [category.id, category.name])));
const activeServices = computed(() => catalog.value.services
  .filter((service) => service.active && service.id !== selectedId.value)
  .map((service) => ({ ...service, categoryName: categoryNames.value.get(service.categoryId) || 'Service' })));
const selectedService = computed(() => catalog.value.services.find((service) => service.id === selectedId.value));
const editorTitle = computed(() => selectedId.value ? (form.value.name || 'Edit service') : 'New service');

const preview = computed(() => {
  const current = form.value;
  const qty = previewQty.value || 1;
  const unit = current.pricing_model === 'PER_KG' ? 'kg' : current.pricing_model === 'PER_ITEM' ? 'items' : 'order';
  let amount;
  if (current.pricing_model === 'FLAT') amount = +current.base_rate || 0;
  else if (current.pricing_model === 'TIERED') {
    const band = current.tiers.find((tier) => qty >= (+tier.min_qty || 0) && (tier.max_qty === '' || qty <= +tier.max_qty));
    amount = band ? (band.band_price !== '' ? +band.band_price : (+band.rate || +current.base_rate) * qty) : (+current.base_rate || 0) * qty;
  } else {
    let rate = +current.base_rate || 0;
    if (current.pricing_model === 'PER_KG') {
      const tier = current.tiers.find((item) => qty >= (+item.min_qty || 0) && (item.max_qty === '' || qty <= +item.max_qty) && item.rate !== '');
      if (tier) rate = +tier.rate;
    }
    amount = rate * qty;
  }
  const minHit = +current.min_charge > 0 && amount < +current.min_charge;
  if (minHit) amount = +current.min_charge;
  const override = Object.values(current.attach).find((item) => item.on && item.override !== '');
  return {
    amount, minHit, unit, qty,
    express: amount * (1 + (+current.express_pct || 0) / 100),
    bundled: override ? +override.override * (current.pricing_model === 'FLAT' ? 1 : qty) : null,
  };
});

function initializeAttach() {
  const attach = {};
  for (const service of catalog.value.services) attach[service.id] = { on: false, override: '', inherit: true };
  return attach;
}

function fillForm(id) {
  const service = catalog.value.services.find((item) => item.id === id);
  if (!service) return;
  const attach = initializeAttach();
  for (const rule of service.attachableTo) {
    attach[rule.parentServiceId] = {
      on: true,
      override: rule.overrideRateCents != null ? rule.overrideRateCents / 100 : '',
      inherit: !!rule.inheritQty,
    };
  }
  selectedId.value = id;
  form.value = {
    name: service.name,
    category_id: service.categoryId,
    pricing_model: service.pricingModel,
    base_rate: service.baseRateCents / 100,
    min_charge: service.minChargeCents / 100,
    express_pct: service.expressPct,
    active: service.active,
    variants: service.variants.map((variant) => ({ label: variant.label, price: variant.priceCents / 100 })),
    tiers: service.tiers.map((tier) => ({
      min_qty: tier.minQty,
      max_qty: tier.maxQty ?? '',
      rate: tier.rateCents != null ? tier.rateCents / 100 : '',
      band_price: tier.bandPriceCents != null ? tier.bandPriceCents / 100 : '',
    })),
    attach,
  };
  savedSnapshot.value = snapshot();
}

function startNew() {
  selectedId.value = null;
  form.value = blank();
  form.value.category_id = catalog.value.categories[0]?.id || '';
  form.value.attach = initializeAttach();
  savedSnapshot.value = snapshot();
}

async function loadDirectory(offset = 0) {
  directoryLoading.value = true;
  directoryError.value = '';
  try {
    const params = new URLSearchParams({ limit: DIRECTORY_LIMIT, offset, status: filters.value.status });
    if (filters.value.q.trim()) params.set('q', filters.value.q.trim());
    if (filters.value.category) params.set('category_id', filters.value.category);
    directory.value = await api.get(`/services?${params}`);
  } catch (error) {
    directoryError.value = error.message;
    toast.error(error.message);
  } finally { directoryLoading.value = false; }
}

async function initialize() {
  try {
    catalog.value = await catalogStore.load(true);
    await loadDirectory(0);
    const initialId = directory.value.rows[0]?.id || catalog.value.services[0]?.id;
    if (initialId) fillForm(initialId);
    else startNew();
  } catch (error) {
    directoryError.value = error.message;
    toast.error(error.message);
    directoryLoading.value = false;
  }
}

function updateCompact(event) { compact.value = event.matches; }
onMounted(() => {
  mediaQuery = window.matchMedia('(max-width: 980px)');
  compact.value = mediaQuery.matches;
  mediaQuery.addEventListener('change', updateCompact);
  initialize();
});
onBeforeUnmount(() => {
  clearTimeout(searchTimer);
  mediaQuery?.removeEventListener('change', updateCompact);
});

function searchDirectory() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadDirectory(0), 250);
}
function guard(action) {
  if (dirty.value) pendingAction.value = action;
  else action();
}
function confirmDiscard() {
  const action = pendingAction.value;
  pendingAction.value = null;
  action?.();
}
function selectService(id) {
  if (id === selectedId.value) { editorOpen.value = true; return; }
  guard(() => { fillForm(id); editorOpen.value = true; });
}
function newService() {
  guard(() => { startNew(); editorOpen.value = true; });
}
function closeEditor() {
  guard(() => { editorOpen.value = false; });
}

async function save() {
  if (!form.value.name.trim()) { toast.error('Service name is required'); return; }
  busy.value = true;
  try {
    const current = form.value;
    const usesVariants = current.pricing_model === 'PER_ITEM';
    const usesTiers = ['PER_KG', 'TIERED'].includes(current.pricing_model);
    const payload = {
      name: current.name,
      category_id: current.category_id,
      pricing_model: current.pricing_model,
      base_rate_cents: Math.round((+current.base_rate || 0) * 100),
      min_charge_cents: Math.round((+current.min_charge || 0) * 100),
      express_pct: +current.express_pct || 0,
      active: current.active,
      variants: usesVariants ? current.variants.filter((variant) => variant.label.trim()).map((variant) => ({
        label: variant.label, price_cents: Math.round((+variant.price || 0) * 100),
      })) : [],
      tiers: usesTiers ? current.tiers.filter((tier) => tier.min_qty !== '').map((tier) => ({
        min_qty: +tier.min_qty,
        max_qty: tier.max_qty === '' ? null : +tier.max_qty,
        rate_cents: current.pricing_model === 'PER_KG' && tier.rate !== '' ? Math.round(+tier.rate * 100) : null,
        band_price_cents: current.pricing_model === 'TIERED' && tier.band_price !== '' ? Math.round(+tier.band_price * 100) : null,
      })) : [],
      attach_to: Object.entries(current.attach).filter(([, item]) => item.on).map(([parentId, item]) => ({
        parent_service_id: parentId,
        override_rate_cents: item.override === '' ? null : Math.round(+item.override * 100),
        inherit_qty: item.inherit,
      })),
    };
    if (selectedId.value) await api.put(`/services/${selectedId.value}`, payload);
    else selectedId.value = (await api.post('/services', payload)).id;
    catalogStore.invalidate();
    catalog.value = await catalogStore.load(true);
    await loadDirectory(directory.value.offset);
    fillForm(selectedId.value);
    editorOpen.value = false;
    toast.success('Service saved. Existing orders keep their original price snapshots.');
  } catch (error) { toast.error(error.message); }
  finally { busy.value = false; }
}

async function retire() {
  if (!selectedId.value) return;
  busy.value = true;
  try {
    await api.delete(`/services/${selectedId.value}`);
    catalogStore.invalidate();
    catalog.value = await catalogStore.load(true);
    retireOpen.value = false;
    editorOpen.value = false;
    selectedId.value = null;
    await loadDirectory(0);
    if (directory.value.rows[0]) fillForm(directory.value.rows[0].id);
    else startNew();
    toast.success('Service removed from new orders');
  } catch (error) { toast.error(error.message); }
  finally { busy.value = false; }
}

async function addCategory() {
  const name = catModal.value.name.trim();
  if (!name) { catModal.value.error = 'Give the category a name'; return; }
  busy.value = true;
  try {
    const category = await api.post('/categories', { name });
    catalog.value.categories.push(category);
    form.value.category_id = category.id;
    catalogStore.invalidate();
    catModal.value = { open: false, name: '', error: '' };
    toast.success(`Category “${name}” added`);
  } catch (error) { catModal.value.error = error.message; }
  finally { busy.value = false; }
}

const pricingLabel = (service) => ({
  PER_KG: 'Per kg', PER_ITEM: 'Per item', FLAT: 'Flat price', TIERED: 'Quantity bands',
}[service.pricingModel] || service.pricingModel);
const rateSummary = (service) => {
  const suffix = service.pricingModel === 'PER_KG' ? '/kg' : service.pricingModel === 'PER_ITEM' ? '/item' : '';
  return `${money(service.baseRateCents, session.currency)}${suffix}`;
};
</script>

<template>
  <div class="builder-page">
    <div class="section-head">
      <div><h2>Service &amp; Pricing Builder</h2><p>Configure what you sell and how each service is priced. Existing orders never change.</p></div>
      <BaseButton icon="plus" @click="newService">New service</BaseButton>
    </div>

    <div class="builder-workspace">
      <Panel class="directory-panel" title="Services" :subtitle="`${directory.total} matching services`" flush>
        <div class="directory-tools">
          <div class="search-box"><AppIcon name="search" :size="14" /><input v-model="filters.q" type="search" placeholder="Search services…" @input="searchDirectory" /></div>
          <div class="filter-row">
            <AppSelect v-model="filters.category" compact @change="loadDirectory(0)"><option value="">All categories</option><option v-for="category in catalog.categories" :key="category.id" :value="category.id">{{ category.name }}</option></AppSelect>
            <AppSelect v-model="filters.status" compact @change="loadDirectory(0)"><option value="active">Active</option><option value="retired">Removed</option><option value="all">All statuses</option></AppSelect>
          </div>
        </div>

        <div class="directory-body">
          <Skeleton v-if="directoryLoading" variant="list" :count="6" />
          <EmptyState v-else-if="directoryError" icon="alert" title="Services could not be loaded" :hint="directoryError"><BaseButton size="sm" variant="ghost" @click="loadDirectory(directory.offset)">Try again</BaseButton></EmptyState>
          <EmptyState v-else-if="!directory.rows.length" icon="builder" :title="filters.q || filters.category || filters.status !== 'active' ? 'No matching services' : 'No services yet'" :hint="filters.q || filters.category || filters.status !== 'active' ? 'Clear or change the filters to see other services.' : 'Create your first service to start taking orders.'"><BaseButton v-if="!filters.q && !filters.category && filters.status === 'active'" size="sm" variant="ghost" icon="plus" @click="newService">Create service</BaseButton></EmptyState>
          <div v-else class="service-list">
            <button v-for="service in directory.rows" :key="service.id" class="service-card"
              :class="{ selected: service.id === selectedId }" @click="selectService(service.id)">
              <span class="service-icon"><AppIcon :name="service.pricingModel === 'PER_KG' ? 'scale' : service.pricingModel === 'PER_ITEM' ? 'shirt' : service.pricingModel === 'TIERED' ? 'tiers' : 'box'" :size="15" /></span>
              <span class="service-copy"><b>{{ service.name }}</b><small>{{ service.categoryName }} · {{ pricingLabel(service) }}</small></span>
              <span class="service-rate"><b>{{ rateSummary(service) }}</b><small v-if="!service.active">Removed</small><AppIcon v-else name="chevronRight" :size="13" /></span>
            </button>
          </div>
        </div>
        <Pagination :total="directory.total" :limit="directory.limit" :offset="directory.offset" @change="loadDirectory" />
      </Panel>

      <Panel v-if="!compact" class="editor-panel" :title="editorTitle"
        :subtitle="selectedId ? `${categoryNames.get(form.category_id) || 'Uncategorised'} · ${dirty ? 'Unsaved changes' : 'Up to date'}` : 'Set up a new service'">
        <ServiceEditor v-model="form" v-model:preview-qty="previewQty" :service-id="selectedId"
          :categories="catalog.categories" :attach-parents="activeServices" :currency="session.currency"
          :preview="preview" :busy="busy" :dirty="dirty" @save="save"
          @add-category="catModal = { open: true, name: '', error: '' }" @retire="retireOpen = true" />
      </Panel>
    </div>

    <Modal v-if="compact && editorOpen" :title="editorTitle"
      :subtitle="selectedId ? `${categoryNames.get(form.category_id) || 'Uncategorised'} · Edit service` : 'Set up a new service'"
      size="workspace" :close-on-backdrop="!dirty" @close="closeEditor">
      <ServiceEditor v-model="form" v-model:preview-qty="previewQty" :service-id="selectedId"
        :categories="catalog.categories" :attach-parents="activeServices" :currency="session.currency"
        :preview="preview" :busy="busy" :dirty="dirty" @save="save"
        @add-category="catModal = { open: true, name: '', error: '' }" @retire="retireOpen = true" />
    </Modal>

    <Modal v-if="catModal.open" title="New category" subtitle="Categories group related services throughout eWash." @close="catModal.open = false">
      <FormField label="Category name" :error="catModal.error" hint="Used in this builder, order intake, and reports."><input v-model="catModal.name" type="text" placeholder="e.g. Curtains & Drapes" @keyup.enter="addCategory" /></FormField>
      <template #footer><BaseButton variant="ghost" :disabled="busy" @click="catModal.open = false">Cancel</BaseButton><BaseButton :loading="busy" @click="addCategory">Add category</BaseButton></template>
    </Modal>

    <ConfirmDialog v-if="pendingAction" title="Discard unsaved changes?" message="Your edits to this service have not been saved. Discard them and continue?" confirm-label="Discard changes" danger @confirm="confirmDiscard" @close="pendingAction = null" />
    <ConfirmDialog v-if="retireOpen" :title="`Remove “${form.name}”?`" message="It will stop appearing on new orders immediately. Existing order prices remain unchanged." confirm-label="Remove service" danger :busy="busy" @confirm="retire" @close="retireOpen = false" />
  </div>
</template>

<style scoped>
.builder-page { min-width: 0; }.builder-workspace { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 14px; align-items: stretch; height: calc(100vh - 174px); min-height: 560px; }
.directory-panel, .editor-panel { min-height: 0; margin: 0; overflow: hidden; }.directory-panel { display: flex; flex-direction: column; }.editor-panel { display: flex; flex-direction: column; }
.directory-tools { padding: 0 14px 10px; border-bottom: 1px solid var(--line); }.search-box { position: relative; }.search-box svg { position: absolute; z-index: 1; left: 10px; top: 50%; transform: translateY(-50%); color: var(--muted); }.search-box input { padding-left: 31px; }
.filter-row { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 7px; }.directory-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px 0; }.directory-panel :deep(.pager) { flex: 0 0 auto; padding: 9px 12px 12px; border-top: 1px solid var(--line); }
.service-list { display: grid; gap: 6px; }.service-card { width: 100%; min-width: 0; padding: 9px; border: 1px solid transparent; border-radius: var(--radius-md); background: transparent; color: var(--ink); font-family: inherit; text-align: left; cursor: pointer; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; }.service-card:hover { background: var(--surface-subtle); }.service-card.selected { border-color: #bcd8d4; background: var(--brand-light); }
.service-icon { width: 30px; height: 30px; display: grid; place-items: center; border-radius: var(--radius-sm); background: var(--surface-muted); color: var(--brand); }.service-card.selected .service-icon { background: var(--card); }.service-copy, .service-rate { min-width: 0; }.service-copy b, .service-copy small, .service-rate b, .service-rate small { display: block; }.service-copy b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }.service-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 9px; }.service-rate { text-align: right; }.service-rate b { color: var(--brand-dark); font-size: 9.5px; }.service-rate small { color: var(--red); font-size: 8.5px; }.service-rate svg { color: var(--muted); }
.editor-panel :deep(.panel-head) { flex: 0 0 auto; }.editor-panel :deep(.service-editor) { flex: 1; overflow-y: auto; padding-right: 2px; }
@media (max-width: 980px) {
  .builder-workspace { display: block; height: auto; min-height: 0; }.directory-panel { min-height: calc(100vh - 190px); }.directory-body { max-height: none; overflow: visible; }.service-card { min-height: 54px; }.service-rate svg { display: inline; }
}
@media (max-width: 640px) {
  .section-head { align-items: flex-start; }.section-head :deep(.btn) { width: 100%; justify-content: center; }.directory-panel { min-height: calc(100vh - 240px); }.filter-row { grid-template-columns: 1fr; }
}
</style>
