<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, tokenStore } from '../api.js';
import { useSession } from '../stores/session.js';
import AppIcon from '../components/AppIcon.vue';
import BaseButton from '../components/BaseButton.vue';

const route = useRoute();
const router = useRouter();
const session = useSession();
const token = computed(() => String(route.query.token || ''));
const state = ref('loading');
const details = ref(null);
const error = ref('');

onMounted(async () => {
  if (!token.value) {
    state.value = 'error';
    error.value = 'This verification link is incomplete.';
    return;
  }
  try {
    details.value = await api.post('/auth/email-change/inspect', { token: token.value });
    state.value = 'ready';
  } catch (e) {
    error.value = e.message;
    state.value = 'error';
  }
});

async function confirm() {
  state.value = 'confirming';
  try {
    details.value = await api.post('/auth/email-change/confirm', { token: token.value });
    tokenStore.clear();
    session.token = null;
    session.me = null;
    state.value = 'done';
  } catch (e) {
    error.value = e.message;
    state.value = 'error';
  }
}
</script>

<template>
  <div class="verify-wrap auth-backdrop">
    <main class="verify-card">
      <div class="verify-brand"><span><AppIcon name="shirt" :size="22" /></span><div><b>eWash</b><small>Account security</small></div></div>
      <div v-if="state === 'loading'" class="state"><span class="spinner" /><h2>Checking your link…</h2></div>
      <div v-else-if="state === 'ready'" class="state">
        <span class="state-icon"><AppIcon name="mail" :size="24" /></span>
        <h2>Confirm your new email</h2>
        <p>Hello {{ details.name }}. Change your eWash login email to:</p>
        <strong class="target-email">{{ details.email }}</strong>
        <p class="note">For security, confirming signs you out on every device. You’ll sign in again with this email.</p>
        <BaseButton block @click="confirm">Confirm email change</BaseButton>
      </div>
      <div v-else-if="state === 'confirming'" class="state"><span class="spinner" /><h2>Updating your account…</h2></div>
      <div v-else-if="state === 'done'" class="state">
        <span class="state-icon success"><AppIcon name="checkCircle" :size="26" /></span>
        <h2>Email updated</h2>
        <p>Your login email is now <b>{{ details.email }}</b>. All previous sessions have been signed out.</p>
        <BaseButton block @click="router.push({ name: 'login' })">Continue to sign in</BaseButton>
      </div>
      <div v-else class="state">
        <span class="state-icon error"><AppIcon name="alert" :size="24" /></span>
        <h2>Link unavailable</h2><p>{{ error }}</p>
        <BaseButton variant="ghost" block @click="router.push({ name: 'login' })">Return to sign in</BaseButton>
      </div>
    </main>
  </div>
</template>

<style scoped>
.verify-wrap { min-height: 100vh; display: grid; place-items: center; padding: 20px; }
.verify-card { width: 100%; max-width: 430px; padding: 24px; border-radius: var(--radius-lg); background: var(--card); box-shadow: var(--shadow-modal); }
.verify-brand { display: flex; gap: 10px; align-items: center; padding-bottom: 16px; margin-bottom: 18px; border-bottom: 1px solid var(--line); }
.verify-brand > span { width: 40px; height: 40px; display: grid; place-items: center; border-radius: var(--radius-md); background: var(--brand-light); color: var(--brand); }
.verify-brand b, .verify-brand small { display: block; }.verify-brand small { color: var(--muted); font-size: 10px; }
.state { text-align: center; }.state h2 { margin: 8px 0 4px; font-size: 18px; }.state p { color: var(--muted); font-size: 11.5px; line-height: 1.55; margin-bottom: 14px; }
.state-icon { width: 50px; height: 50px; display: grid; place-items: center; margin: 0 auto 10px; border-radius: 14px; color: var(--brand); background: var(--brand-light); }
.state-icon.success { color: var(--green); }.state-icon.error { color: var(--red); background: var(--danger-light); }
.target-email { display: block; padding: 10px; margin: 8px 0 12px; border-radius: var(--radius-sm); background: var(--surface-muted); overflow-wrap: anywhere; }
.state .note { font-size: 10.5px; }.spinner { display: inline-block; width: 28px; height: 28px; border: 3px solid var(--line); border-top-color: var(--brand); border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
