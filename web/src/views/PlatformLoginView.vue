<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import AppIcon from '../components/AppIcon.vue';
import FormField from '../components/FormField.vue';
import { usePlatformSession } from '../stores/platformSession.js';

const session = usePlatformSession();
const router = useRouter();
const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    await session.login(email.value, password.value);
    router.push({ name: 'platform-dashboard' });
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="platform-login auth-backdrop">
    <form class="auth-card" @submit.prevent="submit">
      <div class="brand"><span><AppIcon name="shield" :size="22" /></span><div><b>e<em>Wash</em></b><small>Platform Control Centre</small></div></div>
      <h1>Platform sign in</h1>
      <p>Manage tenants, subscriptions and billing.</p>
      <FormField label="Email"><input v-model="email" type="email" autocomplete="username" required /></FormField>
      <FormField label="Password"><input v-model="password" type="password" autocomplete="current-password" required /></FormField>
      <p v-if="error" class="error-text">{{ error }}</p>
      <button class="btn btn-primary submit" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in securely' }}</button>
      <router-link to="/login">Tenant sign in</router-link>
    </form>
  </main>
</template>

<style scoped>
.platform-login { min-height: 100vh; display: grid; place-items: center; padding: 20px; }
.auth-card { width: 100%; max-width: 420px; padding: 28px; border-radius: 18px; background: #fff; box-shadow: 0 24px 64px rgba(0,0,0,.32); }
.brand { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.brand > span { width: 42px; height: 42px; display: grid; place-items: center; color: #0c4d49; background: #77d2c3; border-radius: 12px; }
.brand b { font: 800 20px var(--font-ui); }.brand em { color: var(--brand); font-style: normal; }.brand small { display: block; color: var(--muted); font-size: 10px; }
h1 { margin: 0 0 4px; font: 700 19px var(--font-ui); } form > p { color: var(--muted); font-size: 11.5px; margin: 0 0 18px; }
.submit { width: 100%; justify-content: center; margin-top: 4px; } a { display: block; margin-top: 14px; text-align: center; color: var(--brand); font-size: 11px; text-decoration: none; }
</style>
