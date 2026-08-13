<script setup>
// Idle-lock overlay: appears after inactivity; unlocking requires the user's
// password (verified server-side, rate-limited) — or a full logout.
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSession } from '../stores/session.js';
import { SUPPORT_EMAIL } from '../config.js';
import Avatar from './Avatar.vue';
import AppIcon from './AppIcon.vue';

const session = useSession();
const router = useRouter();
const password = ref('');
const error = ref('');
const busy = ref(false);

async function unlock() {
  if (!password.value) return;
  busy.value = true;
  error.value = '';
  try {
    await session.unlockWithPassword(password.value);
    password.value = '';
  } catch (e) {
    error.value = e.message;
    password.value = '';
  } finally {
    busy.value = false;
  }
}

async function logout() {
  await session.logout();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="lock-overlay">
    <div class="lock-card">
      <div class="lock-icon"><AppIcon name="shield" :size="22" /></div>
      <Avatar :name="session.user?.name || '?'" :size="54" />
      <h2>{{ session.user?.name }}</h2>
      <template v-if="session.user?.hasPassword">
        <p>Tela bloqueada por inatividade. Digite sua senha para continuar.</p>
        <form @submit.prevent="unlock">
          <input
            v-model="password" type="password" placeholder="Password"
            autocomplete="current-password" autofocus
          />
          <p v-if="error" class="error-text">{{ error }}</p>
          <button class="btn btn-primary" type="submit" :disabled="busy || !password">
            {{ busy ? 'Verificando…' : 'Desbloquear' }}
          </button>
        </form>
      </template>
      <p v-else>
        Tela bloqueada por inatividade. Esta conta entra com o Google —
        sign out below and continue with Google to unlock.
      </p>
      <button class="switch-user" @click="logout">
        <AppIcon name="logout" :size="13" /> Sign out &amp; log in afresh
      </button>
      <p class="support">Locked out? <a :href="`mailto:${SUPPORT_EMAIL}`">{{ SUPPORT_EMAIL }}</a></p>
    </div>
  </div>
</template>

<style scoped>
.lock-overlay {
  position: fixed; inset: 0; z-index: 200; display: grid; place-items: center;
  background: rgba(10, 28, 26, 0.72); backdrop-filter: blur(10px); padding: 20px;
}
.lock-card {
  width: 100%; max-width: 350px; background: #fff; border-radius: 18px;
  padding: 26px 26px 20px; text-align: center;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4); position: relative;
}
.lock-icon {
  position: absolute; top: -16px; left: 50%; transform: translateX(-50%);
  width: 36px; height: 36px; display: grid; place-items: center;
  background: var(--brand); color: #fff; border-radius: 50%;
  box-shadow: 0 5px 14px rgba(18, 109, 103, 0.4);
}
.lock-card h2 { font: 700 17px var(--font-ui); margin: 10px 0 2px; }
.lock-card > p { color: var(--muted); font-size: 12px; margin-bottom: 14px; }
.lock-card input { text-align: center; margin-bottom: 10px; }
.lock-card .btn { width: 100%; justify-content: center; }
.switch-user {
  margin-top: 14px; border: none; background: none; color: var(--muted);
  font-size: 11.5px; font-weight: 600; cursor: pointer; font-family: inherit;
  display: inline-flex; align-items: center; gap: 6px;
}
.switch-user:hover { color: var(--red); }
.support { margin-top: 10px; color: var(--muted); font-size: 10.5px; }
.support a { color: var(--brand); font-weight: 600; text-decoration: none; }
</style>
