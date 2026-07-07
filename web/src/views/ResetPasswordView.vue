<script setup>
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import AppIcon from '../components/AppIcon.vue';
import FormField from '../components/FormField.vue';

const route = useRoute();
const router = useRouter();
const password = ref('');
const confirmPassword = ref('');
const busy = ref(false);
const error = ref('');
const done = ref(false);
const token = computed(() => String(route.query.token || ''));

async function submit() {
  error.value = '';
  if (password.value !== confirmPassword.value) {
    error.value = 'Passwords do not match';
    return;
  }
  busy.value = true;
  try {
    await api.post('/auth/reset-password', { token: token.value, password: password.value });
    done.value = true;
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="reset-wrap">
    <div class="reset-card">
      <div class="reset-brand"><span><AppIcon name="shirt" :size="22" /></span><div><b>eWash</b><small>Laundry Management System</small></div></div>
      <template v-if="done">
        <div class="success"><AppIcon name="checkCircle" :size="30" /><h2>Password updated</h2><p>All previous sessions have been signed out.</p></div>
        <button class="btn btn-primary full" @click="router.push({ name: 'login' })">Continue to sign in</button>
      </template>
      <form v-else @submit.prevent="submit">
        <h2>Choose a new password</h2>
        <p class="muted">The reset link expires after 30 minutes and works once.</p>
        <FormField label="New password" hint="At least 8 characters"><input v-model="password" type="password" autocomplete="new-password" required minlength="8" /></FormField>
        <FormField label="Confirm password"><input v-model="confirmPassword" type="password" autocomplete="new-password" required minlength="8" /></FormField>
        <p v-if="!token" class="error-text">This reset link is incomplete.</p>
        <p v-if="error" class="error-text">{{ error }}</p>
        <button class="btn btn-primary full" :disabled="busy || !token">{{ busy ? 'Updating…' : 'Reset password' }}</button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.reset-wrap { min-height: 100vh; display: grid; place-items: center; padding: 20px; background: var(--side); }
.reset-card { width: 100%; max-width: 420px; padding: 26px; border-radius: 18px; background: #fff; box-shadow: 0 24px 64px rgba(0,0,0,.3); }
.reset-brand { display: flex; gap: 10px; align-items: center; margin-bottom: 20px; }
.reset-brand > span { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 11px; background: #77d2c3; color: #0c4d49; }
.reset-brand b, .reset-brand small { display: block; }.reset-brand small { color: var(--muted); font-size: 10px; }
h2 { font-size: 18px; margin-bottom: 3px; }form > .muted { font-size: 11px; margin-bottom: 16px; }
form :deep(.ff) { margin-bottom: 12px; }.full { width: 100%; justify-content: center; margin-top: 5px; }
.success { text-align: center; color: var(--brand); margin: 18px 0; }.success p { color: var(--muted); font-size: 11px; }
</style>
