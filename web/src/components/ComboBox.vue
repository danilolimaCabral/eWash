<script setup>
// Searchable combobox with an "add new" affordance (customer picker at intake).
// items: [{ id, label, sub }]. Emits select(item) and create(query).
import { ref, computed } from 'vue';
import Avatar from './Avatar.vue';

const props = defineProps({
  items: { type: Array, required: true },
  placeholder: { type: String, default: 'Type to search…' },
  allowCreate: { type: Boolean, default: true },
  modelValue: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue', 'select', 'create']);

const open = ref(false);
const query = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const hits = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.items.slice(0, 8);
  const nq = q.replace(/\s/g, '');
  return props.items
    .filter((i) =>
      i.label.toLowerCase().includes(q) ||
      (i.sub || '').replace(/\s/g, '').toLowerCase().includes(nq))
    .slice(0, 8);
});

function pick(item) {
  emit('select', item);
  open.value = false;
}
function create() {
  emit('create', query.value.trim());
  open.value = false;
}
function blur() {
  setTimeout(() => { open.value = false; }, 160);
}
</script>

<template>
  <div class="combo">
    <input
      v-model="query" type="text" :placeholder="placeholder" autocomplete="off"
      @focus="open = true" @input="open = true" @blur="blur"
    />
    <div v-if="open" class="combo-list">
      <div v-for="item in hits" :key="item.id" class="combo-item" @mousedown.prevent="pick(item)">
        <Avatar :name="item.label" :size="24" />
        <span>{{ item.label }}</span>
        <small v-if="item.sub">{{ item.sub }}</small>
      </div>
      <div v-if="allowCreate && query.trim()" class="combo-item combo-new" @mousedown.prevent="create">
        ＋ Add “{{ query.trim() }}” as a new customer
      </div>
      <div v-if="!hits.length && !(allowCreate && query.trim())" class="combo-empty">No matches</div>
    </div>
  </div>
</template>

<style scoped>
.combo { position: relative; }
.combo-list {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 40; background: #fff;
  border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 12px 28px rgba(14,36,36,0.14); max-height: 240px; overflow: auto; margin-top: 4px;
}
.combo-item { padding: 8px 12px; font-size: 12.5px; cursor: pointer; display: flex; align-items: center; gap: 9px; }
.combo-item:hover { background: #f0f7f5; }
.combo-item small { color: var(--muted); margin-left: auto; padding-left: 10px; }
.combo-new { color: var(--brand); font-weight: 700; border-top: 1px solid var(--line); }
.combo-empty { padding: 10px 12px; color: var(--muted); font-size: 12px; }
</style>
