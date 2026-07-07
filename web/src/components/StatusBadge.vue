<script setup>
import { computed } from 'vue';
import { ORDER_STATUS_LABELS, PAY_STATUS_LABELS } from '../utils/format.js';

const props = defineProps({
  status: { type: String, required: true },
  kind: { type: String, default: 'order' }, // order | payment | generic
  label: { type: String, default: '' },
});

const text = computed(() =>
  props.label ||
  (props.kind === 'order' ? ORDER_STATUS_LABELS[props.status] : PAY_STATUS_LABELS[props.status]) ||
  props.status
);

const TONES = {
  received: 'blue', washing: 'violet', ironing: 'amber', ready: 'green',
  delivered: 'gray', void: 'red',
  unpaid: 'red', partially_paid: 'amber', paid: 'green', refunded: 'gray',
  sent: 'green', queued: 'amber', failed: 'red',
  pending: 'amber', completed: 'green',
  active: 'green', trial: 'blue', past_due: 'amber', suspended: 'red',
  cancelled: 'gray', draft: 'gray', issued: 'blue', partially_paid: 'amber',
  overdue: 'red',
};
const tone = computed(() => TONES[props.status] || 'gray');
</script>

<template>
  <span class="badge" :class="tone"><i />{{ text }}</span>
</template>

<style scoped>
.badge {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px;
  border-radius: 999px; font-size: 10.5px; font-weight: 700; white-space: nowrap;
}
.badge i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.blue { background: #e3f1f9; color: #2f77a3; }
.violet { background: #efeafa; color: #6a58a8; }
.amber { background: #fdf1df; color: #b47a2b; }
.green { background: #e2f4ec; color: #1f7a5f; }
.gray { background: #eceff0; color: #56656a; }
.red { background: #fdeae8; color: #b8483c; }
</style>
