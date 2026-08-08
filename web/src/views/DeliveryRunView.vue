<script setup>
// Public rider page (no login): opened from the SMS link a delivery provider
// receives. Shows the tag huge and centered, and one job — press "Delivered"
// to close the run and notify the customer. Uses bare fetch: no session, no
// auth headers, tiny and fast on a phone.
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import AppIcon from '../components/AppIcon.vue';

const route = useRoute();
const run = ref(null);
const state = ref('loading'); // loading | ready | done | error
const busy = ref(false);
const confirmOpen = ref(false); // marking delivered is irreversible — ask first

const base = `/api/delivery/${encodeURIComponent(route.params.token)}`;

onMounted(async () => {
  try {
    const res = await fetch(base);
    if (!res.ok) throw new Error();
    run.value = await res.json();
    state.value = run.value.delivered ? 'done' : 'ready';
  } catch {
    state.value = 'error';
  }
});

async function confirmDelivered() {
  busy.value = true;
  try {
    const res = await fetch(`${base}/delivered`, { method: 'POST' });
    if (!res.ok) throw new Error();
    state.value = 'done';
    confirmOpen.value = false;
  } catch {
    // leave the button usable — flaky connections are normal on the road
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="run">
    <template v-if="state === 'loading'">
      <p class="dim">Loading delivery…</p>
    </template>

    <template v-else-if="state === 'error'">
      <div class="state-icon error-icon"><AppIcon name="alert" :size="46" /></div>
      <p class="dim">This delivery link is not valid.<br />Please check the SMS you received.</p>
    </template>

    <template v-else>
      <p class="biz">{{ run.business }}</p>
      <p class="dim">Deliver order</p>
      <div class="tag-code">{{ run.code }}</div>
      <p class="who">
        to <b>{{ run.customerName }}</b><br />
        <a :href="`tel:${run.customerPhone}`" class="tel">{{ run.customerPhone }}</a>
      </p>

      <button v-if="state === 'ready'" class="deliver-btn" :disabled="busy" @click="confirmOpen = true">
        <AppIcon name="check" :size="21" /> Delivered
      </button>
      <div v-else class="done-note">
        <span class="done-badge"><AppIcon name="checkCircle" :size="20" /> Delivered</span>
        <p class="dim">Thank you! The customer has been notified.</p>
      </div>
    </template>

    <ConfirmDialog v-if="confirmOpen" :busy="busy"
      :title="`Order ${run?.code} handed to the customer?`"
      message="This cannot be undone — the customer is notified immediately that their clothes have arrived."
      confirm-label="Yes, delivered"
      @confirm="confirmDelivered" @close="confirmOpen = false" />
  </div>
</template>

<style scoped>
.run {
  min-height: 100vh; min-height: 100dvh; background: var(--side); color: #e2e8f0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 24px; gap: 10px;
}
.biz { font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #9fb8b3; }
.dim { color: #9fb8b3; font-size: 14px; line-height: 1.6; }
.tag-code {
  font: 800 clamp(56px, 18vw, 120px) var(--font-ui); color: #7ed7c9;
  letter-spacing: 0.06em; line-height: 1.1; margin: 6px 0;
}
.state-icon { display: grid; place-items: center; width: 76px; height: 76px; margin: 6px 0; border-radius: 50%; }
.error-icon { color: #f2a399; background: rgba(242, 163, 153, 0.1); }
.who { font-size: 17px; line-height: 1.7; }
.tel { color: #7ed7c9; font-weight: 700; font-size: 19px; text-decoration: none; }
.deliver-btn {
  margin-top: 22px; border: none; border-radius: 16px; cursor: pointer;
  background: var(--green); color: #fff; font: 800 20px var(--font-ui);
  display: inline-flex; align-items: center; gap: 8px; padding: 18px 46px;
  box-shadow: 0 10px 28px rgba(38, 130, 108, 0.45);
}
.deliver-btn:disabled { opacity: 0.6; }
.done-note { margin-top: 18px; display: flex; flex-direction: column; gap: 8px; align-items: center; }
.done-badge {
  background: rgba(126, 215, 201, 0.15); border: 1px solid #7ed7c9; color: #7ed7c9;
  display: inline-flex; align-items: center; gap: 7px; font: 800 18px var(--font-ui);
  padding: 10px 26px; border-radius: 999px;
}
</style>
