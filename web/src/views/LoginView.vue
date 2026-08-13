<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import AppIcon from '../components/AppIcon.vue';
import FormField from '../components/FormField.vue';
import { SUPPORT_EMAIL } from '../config.js';

const session = useSession();
const router = useRouter();
const toast = useToast();

const mode = ref('login'); // login | register | forgot | google-complete | check-email
const busy = ref(false);
const error = ref('');
const form = ref({
  email: '', password: '',
  business_name: '', branch_name: '', name: '', phone: '',
});
const gticket = ref('');
const googleBusy = ref(false);
const sentTo = ref('');
const devActivationUrl = ref(''); // only ever present outside production

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    if (mode.value === 'forgot') {
      const result = await api.post('/auth/forgot-password', { email: form.value.email });
      toast.success(result.message);
      mode.value = 'login';
      return;
    } else if (mode.value === 'login') {
      await session.login(form.value.email, form.value.password);
    } else if (mode.value === 'google-complete') {
      const pair = await api.post('/auth/google/complete', {
        ticket: gticket.value,
        business_name: form.value.business_name,
        branch_name: form.value.branch_name,
        name: form.value.name,
        phone: form.value.phone,
      });
      session.setTokens(pair);
      session.unlock();
      await session.loadMe();
      toast.success('Bem-vindo(a)! Sua lavanderia foi configurada com um catálogo modelo — ajuste os preços no Construtor de Serviços.');
    } else {
      // registration does not sign in — the account activates via email
      const result = await session.register({ ...form.value });
      sentTo.value = form.value.email;
      devActivationUrl.value = result.activation_url || '';
      mode.value = 'check-email';
      return;
    }
    router.push({ name: 'dashboard' });
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

function googleStart() {
  googleBusy.value = true; // show progress until the browser leaves for Google
  window.location.href = '/api/auth/google/start';
}

// Handle the OAuth return: tokens (existing/linked user), a signup ticket
// (new user → mandatory onboarding fields), or an error message.
onMounted(async () => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (!params.toString()) return;
  history.replaceState(null, '', window.location.pathname); // never keep tokens in the URL
  if (params.get('gerror')) {
    error.value = params.get('gerror');
    return;
  }
  if (params.get('gauth')) {
    try {
      const pair = JSON.parse(atob(params.get('gauth')));
      session.setTokens(pair);
      session.unlock();
      await session.loadMe();
      router.push({ name: 'dashboard' });
    } catch {
      error.value = 'Entrar com Google falhou — tente novamente';
    }
    return;
  }
  if (params.get('gticket')) {
    gticket.value = params.get('gticket');
    form.value.name = params.get('gname') || '';
    form.value.email = params.get('gemail') || '';
    mode.value = 'google-complete';
  }
});
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-brand">
        <span class="brand-mark"><AppIcon name="shirt" :size="22" /></span>
        <div><b>LavTr</b><small>Sistema de Gestão para Lavanderias</small></div>
      </div>

      <div v-if="mode === 'login' || mode === 'register'" class="mode-tabs">
        <button :class="{ active: mode === 'login' }" @click="mode = 'login'">Entrar</button>
        <button :class="{ active: mode === 'register' }" @click="mode = 'register'">Começar minha lavanderia</button>
      </div>
      <div v-else-if="mode !== 'check-email'" class="gc-head">
        <template v-if="mode === 'forgot'">
          <b>Esqueceu a senha?</b>
          <p class="muted small">Informe o e-mail da conta e enviaremos um link seguro de redefinição válido por 30 minutos.</p>
        </template>
        <template v-else>
        <b>Quase lá — configure sua lavanderia</b>
        <p class="muted small">Conectado com o Google como <b>{{ form.email }}</b>. Complete os dados da empresa para começar.</p>
        </template>
      </div>

      <!-- Google is the default way in; email & password is the fallback -->
      <template v-if="mode === 'login' || mode === 'register'">
        <button class="btn google-btn" type="button" :disabled="busy || googleBusy" @click="googleStart">
          <span v-if="googleBusy" class="btn-spin dark" aria-hidden="true" />
          <svg v-else width="17" height="17" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
          {{ googleBusy ? 'Redirecionando ao Google…' : mode === 'login' ? 'Continuar com Google' : 'Cadastrar com Google' }}
        </button>
        <div class="divider"><span>ou continue com e-mail</span></div>
      </template>

      <div v-if="mode === 'check-email'" class="check-email">
        <span class="mail-badge"><AppIcon name="mail" :size="26" /></span>
        <b>Confira seu e-mail</b>
        <p class="muted small">Enviamos um link de ativação para <b>{{ sentTo }}</b>. Abra-o para concluir — ele expira em 24 horas.</p>
        <a v-if="devActivationUrl" class="btn btn-primary dev-activate" :href="devActivationUrl">Abrir link de ativação (dev)</a>
        <button type="button" class="back-link" @click="mode = 'login'; error = ''">Voltar ao login</button>
      </div>

      <form v-else @submit.prevent="submit">
        <template v-if="mode === 'register' || mode === 'google-complete'">
          <div class="row">
            <FormField label="Nome da lavanderia"><input v-model="form.business_name" type="text" placeholder="Ex.: Lavanderia Modelo" required /></FormField>
          </div>
          <div class="row">
            <FormField label="Primeira unidade"><input v-model="form.branch_name" type="text" placeholder="Ex.: Centro" required /></FormField>
            <FormField label="Seu nome"><input v-model="form.name" type="text" placeholder="Dono / gerente" required /></FormField>
          </div>
          <div class="row">
            <FormField label="Telefone"><input v-model="form.phone" type="tel" placeholder="(11) 9xxxx-xxxx" :required="mode === 'google-complete'" /></FormField>
          </div>
        </template>
        <template v-if="mode !== 'google-complete'">
          <div class="row">
            <FormField label="E-mail"><input v-model="form.email" type="email" autocomplete="username" required /></FormField>
          </div>
          <div v-if="mode !== 'forgot'" class="row">
            <FormField label="Senha" :hint="mode === 'register' ? 'Mínimo de 8 caracteres' : ''">
              <input v-model="form.password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" required />
            </FormField>
          </div>
        </template>
        <p v-if="error" class="error-text">{{ error }}</p>
        <button class="btn btn-primary submit" type="submit" :disabled="busy || googleBusy">
          <span v-if="busy" class="btn-spin" aria-hidden="true" />
          {{ busy
            ? (mode === 'login' ? 'Entrando…' : mode === 'forgot' ? 'Enviando…' : 'Configurando…')
            : mode === 'forgot' ? 'Enviar link de redefinição'
            : mode === 'login' ? 'Entrar'
            : mode === 'google-complete' ? 'Concluir — comece em minutos'
            : 'Criar minha lavanderia — comece em minutos' }}
        </button>
        <button v-if="mode === 'forgot'" type="button" class="back-link" @click="mode = 'login'">Voltar ao login</button>
        <button v-else-if="mode === 'login'" type="button" class="forgot-link" @click="mode = 'forgot'; error = ''">Esqueceu a senha?</button>
        <p v-if="mode === 'register'" class="muted small note">
          Você recebe um catálogo modelo de lavanderia brasileira (lavagem por quilo, passadoria, edredons, tinturaria) — edite tudo depois no Construtor de Serviços.
        </p>
      </form>

      <p class="support">
        Precisa de ajuda? <a :href="`mailto:${SUPPORT_EMAIL}`">{{ SUPPORT_EMAIL }}</a>
      </p>
    </div>
  </div>
</template>

<style scoped>
.auth-wrap { min-height: 100vh; display: grid; place-items: center; background: var(--side); padding: 20px; }
.auth-card { width: 100%; max-width: 440px; background: #fff; border-radius: 18px; padding: 28px; box-shadow: 0 24px 64px rgba(0,0,0,0.35); }
.auth-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
.auth-brand .brand-mark { width: 42px; height: 42px; display: grid; place-items: center; background: #77d2c3; border-radius: 12px; color: #0c4d49; }
.auth-brand b { font: 800 20px var(--font-ui); }
.auth-brand em { color: var(--brand); font-style: normal; }
.auth-brand small { display: block; color: var(--muted); font-size: 11px; }
.mode-tabs { display: flex; gap: 4px; background: #f0f5f4; border-radius: 10px; padding: 4px; margin-bottom: 18px; }
.mode-tabs button {
  flex: 1; border: none; background: none; padding: 9px; font-size: 12.5px; font-weight: 700;
  color: var(--muted); cursor: pointer; border-radius: 8px; font-family: inherit;
}
.mode-tabs button.active { background: #fff; color: var(--brand-dark); box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
.submit { width: 100%; justify-content: center; padding: 11px; font-size: 14px; gap: 8px; }
.btn-spin {
  width: 15px; height: 15px; flex-shrink: 0; border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.5); border-top-color: #fff;
  animation: btn-rotate 0.7s linear infinite;
}
.btn-spin.dark { border-color: rgba(18, 109, 103, 0.3); border-top-color: var(--brand); }
@keyframes btn-rotate { to { transform: rotate(360deg); } }
.note { margin-top: 12px; text-align: center; }
.support { margin-top: 16px; text-align: center; color: var(--muted); font-size: 11.5px; }
.support a { color: var(--brand); font-weight: 600; text-decoration: none; }
.gc-head { margin-bottom: 16px; }
.gc-head b { font: 700 15px var(--font-ui); display: block; margin-bottom: 3px; }
.divider { display: flex; align-items: center; gap: 10px; margin: 14px 0 14px; color: var(--muted); font-size: 11px; }
.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--line); }
.google-btn {
  width: 100%; justify-content: center; padding: 11px; font-size: 14px; font-weight: 700;
  background: #fff; color: var(--ink); border: 1.5px solid #bcd8d4;
  box-shadow: 0 3px 10px rgba(18,109,103,0.10);
}
.google-btn:hover:not(:disabled) { background: var(--brand-light); border-color: var(--brand); }
.check-email { text-align: center; padding: 8px 4px 2px; }
.check-email .mail-badge {
  width: 48px; height: 48px; margin: 0 auto 10px; display: grid; place-items: center;
  border-radius: 14px; background: var(--brand-light); color: var(--brand);
}
.check-email > b { display: block; font: 700 15px var(--font-ui); margin-bottom: 4px; }
.check-email p { margin: 0 auto; max-width: 320px; }
.dev-activate { margin-top: 14px; text-decoration: none; }
.forgot-link, .back-link { display: block; margin: 10px auto 0; border: 0; background: none; color: var(--brand); font: 600 11.5px var(--font-ui); cursor: pointer; }
</style>
