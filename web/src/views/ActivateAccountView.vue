<script setup>
// Landing page for emailed activation links. Two variants, decided server-side:
// owner self-signup links activate + sign in immediately; staff invite links
// first ask the invitee to choose their password.
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import AppIcon from '../components/AppIcon.vue';
import FormField from '../components/FormField.vue';

const route = useRoute();
const router = useRouter();
const session = useSession();
const toast = useToast();

const token = String(route.query.token || '');
const state = ref('loading'); // loading | set-password | failed
const error = ref('');
const invite = ref(null); // { name, email, business }
const password = ref('');
const confirmPassword = ref('');
const busy = ref(false);

async function redeem(body) {
  const pair = await api.post('/auth/activate', body);
  session.setTokens(pair);
  session.unlock();
  await session.loadMe();
  toast.success(invite.value
    ? `Bem-vindo(a) à ${invite.value.business}! Tudo pronto.`
    : 'Bem-vindo(a)! Sua lavanderia está no ar — ajuste os preços a qualquer momento no Construtor de Serviços.');
  router.replace({ name: 'dashboard' });
}

async function acceptInvite() {
  error.value = '';
  if (password.value !== confirmPassword.value) {
    error.value = 'Passwords do not match';
    return;
  }
  busy.value = true;
  try {
    await redeem({ token, password: password.value });
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

onMounted(async () => {
  if (!token) {
    error.value = 'This activation link is incomplete — use the button in your email.';
    state.value = 'failed';
    return;
  }
  try {
    const info = await api.post('/auth/activate/inspect', { token });
    if (info.mode === 'set_password') {
      invite.value = info;
      state.value = 'set-password';
    } else {
      await redeem({ token });
    }
  } catch (e) {
    error.value = e.message;
    state.value = 'failed';
  }
});
</script>

<template>
  <div class="activate-wrap">
    <div class="activate-card">
      <div class="activate-brand"><span><AppIcon name="shirt" :size="22" /></span><div><b>LavTr</b><small>Laundry Management System</small></div></div>

      <div v-if="state === 'loading'" class="pending">
        <span class="spin" aria-hidden="true" />
        <h2>Activating your account…</h2>
        <p class="muted">Hang tight — signing you in.</p>
      </div>

      <form v-else-if="state === 'set-password'" @submit.prevent="acceptInvite">
        <h2>Join {{ invite.business }}</h2>
        <p class="muted lead">Bem-vindo(a), {{ invite.name }} — escolha a senha com que você entrará como <b>{{ invite.email }}</b>.</p>
        <FormField label="Password" hint="At least 8 characters"><input v-model="password" type="password" autocomplete="new-password" required minlength="8" /></FormField>
        <FormField label="Confirm password"><input v-model="confirmPassword" type="password" autocomplete="new-password" required minlength="8" /></FormField>
        <p v-if="error" class="error-text">{{ error }}</p>
        <button class="btn btn-primary full" :disabled="busy">{{ busy ? 'Joining…' : 'Accept invitation & join' }}</button>
      </form>

      <div v-else class="failed">
        <AppIcon name="alert" :size="30" />
        <h2>Activation failed</h2>
        <p class="muted">{{ error }}</p>
        <p class="muted">Links expire and work once. Ask for a fresh link, or sign in if your account is already active.</p>
        <button class="btn btn-primary full" @click="router.push({ name: 'login' })">Back to sign in</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.activate-wrap { min-height: 100vh; display: grid; place-items: center; padding: 20px; background: var(--side); }
.activate-card { width: 100%; max-width: 420px; padding: 26px; border-radius: 18px; background: #fff; box-shadow: 0 24px 64px rgba(0,0,0,.3); }
.activate-brand { display: flex; gap: 10px; align-items: center; margin-bottom: 20px; }
.activate-brand > span { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 11px; background: #77d2c3; color: #0c4d49; }
.activate-brand b, .activate-brand small { display: block; }.activate-brand small { color: var(--muted); font-size: 10px; }
.pending, .failed { text-align: center; margin: 14px 0 6px; }
.failed { color: var(--red); }
h2 { font-size: 17px; margin: 10px 0 4px; color: var(--ink); }
form h2 { margin-top: 0; }
form .lead { font-size: 11.5px; margin-bottom: 16px; }
form :deep(.ff) { margin-bottom: 12px; }
.pending .muted, .failed .muted { color: var(--muted); font-size: 11.5px; margin: 4px 0; }
.spin {
  display: inline-block; width: 26px; height: 26px; border-radius: 50%;
  border: 3px solid var(--brand-light); border-top-color: var(--brand);
  animation: act-rotate 0.7s linear infinite;
}
@keyframes act-rotate { to { transform: rotate(360deg); } }
.full { width: 100%; justify-content: center; margin-top: 14px; }
</style>
