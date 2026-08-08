<script setup>
// Reusable account editor; the shell owns API calls and session refreshes.
import { computed, ref, watch } from 'vue';
import Modal from './Modal.vue';
import FormField from './FormField.vue';
import BaseButton from './BaseButton.vue';
import AppIcon from './AppIcon.vue';
import Tabs from './Tabs.vue';

const props = defineProps({
  user: { type: Object, required: true },
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'save-profile', 'request-email', 'change-password', 'setup-password']);
const tab = ref('profile');
const profile = ref({ name: '', phone: '' });
const newEmail = ref('');
const password = ref({ current: '', next: '', confirm: '' });
const localError = ref('');

watch(() => props.user, (user) => {
  profile.value = { name: user.name || '', phone: user.phone || '' };
}, { immediate: true, deep: true });

const profileChanged = computed(() =>
  profile.value.name.trim() !== props.user.name || profile.value.phone.trim() !== (props.user.phone || ''));

function changePassword() {
  localError.value = '';
  if (password.value.next !== password.value.confirm) {
    localError.value = 'New passwords do not match';
    return;
  }
  emit('change-password', {
    current_password: password.value.current,
    new_password: password.value.next,
  });
}
</script>

<template>
  <Modal title="Account settings" subtitle="Manage your profile, login email, and password." @close="$emit('close')">
    <Tabs v-model="tab" :tabs="[{ key: 'profile', label: 'Profile', icon: 'customers' }, { key: 'security', label: 'Security', icon: 'shield' }]" />

    <div v-if="tab === 'profile'" class="section-stack">
      <section class="settings-section">
        <div class="section-title"><AppIcon name="customers" :size="17" /><div><h4>Personal details</h4><p>Shown to your team inside eWash.</p></div></div>
        <div class="field-grid">
          <FormField label="Name"><input v-model="profile.name" autocomplete="name" /></FormField>
          <FormField label="Phone"><input v-model="profile.phone" type="tel" autocomplete="tel" /></FormField>
        </div>
        <div class="inline-action">
          <span class="muted small">These changes take effect immediately.</span>
          <BaseButton size="sm" :loading="busy" :disabled="!profileChanged || !profile.name.trim()"
            @click="$emit('save-profile', profile)">Save details</BaseButton>
        </div>
      </section>

      <section class="settings-section">
        <div class="section-title"><AppIcon name="mail" :size="17" /><div><h4>Login email</h4><p>Your current email stays active until the new one is verified.</p></div></div>
        <div class="current-email"><span>Current</span><b>{{ user.email }}</b></div>
        <div v-if="user.pendingEmail" class="pending-email"><span>Awaiting verification</span><b>{{ user.pendingEmail }}</b></div>
        <div class="email-action">
          <FormField label="New email address"><input v-model="newEmail" type="email" autocomplete="email" /></FormField>
          <BaseButton variant="ghost" size="sm" :loading="busy" :disabled="!newEmail.trim()"
            @click="$emit('request-email', newEmail)">Send verification</BaseButton>
        </div>
      </section>
    </div>

    <section v-else class="settings-section security-section">
      <template v-if="user.hasPassword">
        <div class="section-title"><AppIcon name="shield" :size="17" /><div><h4>Change password</h4><p>Your other sessions will be signed out after the change.</p></div></div>
        <FormField label="Current password"><input v-model="password.current" type="password" autocomplete="current-password" /></FormField>
        <div class="field-grid">
          <FormField label="New password" hint="At least 8 characters"><input v-model="password.next" type="password" autocomplete="new-password" minlength="8" /></FormField>
          <FormField label="Confirm new password"><input v-model="password.confirm" type="password" autocomplete="new-password" minlength="8" /></FormField>
        </div>
        <p v-if="localError" class="error-text">{{ localError }}</p>
        <div class="inline-action">
          <span class="muted small">This device remains signed in.</span>
          <BaseButton :loading="busy" :disabled="!password.current || password.next.length < 8" @click="changePassword">Change password</BaseButton>
        </div>
      </template>
      <template v-else>
        <div class="google-state">
          <span class="state-icon"><AppIcon name="shield" :size="22" /></span>
          <h4>Your account uses Google sign-in</h4>
          <p>You do not currently have an eWash password. We can email a secure one-time setup link to <b>{{ user.email }}</b>. Your Google sign-in will continue to work.</p>
          <BaseButton :loading="busy" @click="$emit('setup-password')">Email password setup link</BaseButton>
        </div>
      </template>
    </section>
  </Modal>
</template>

<style scoped>
.section-stack { display: grid; gap: 12px; }
.settings-section { padding: 13px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--card); }
.section-title { display: flex; gap: 9px; align-items: flex-start; margin-bottom: 12px; color: var(--brand); }
.section-title h4 { color: var(--ink); font-size: 12.5px; }
.section-title p { margin-top: 1px; color: var(--muted); font-size: 10px; }
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.inline-action { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; }
.current-email, .pending-email { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 11px; overflow-wrap: anywhere; }
.current-email span, .pending-email span { color: var(--muted); }
.pending-email { color: var(--accent); }
.email-action { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px; align-items: end; margin-top: 11px; }
.security-section :deep(.ff) { margin-bottom: 10px; }
.google-state { max-width: 420px; margin: 8px auto; text-align: center; }
.state-icon { width: 48px; height: 48px; margin: 0 auto 10px; display: grid; place-items: center; border-radius: 13px; background: var(--brand-light); color: var(--brand); }
.google-state h4 { font-size: 14px; margin-bottom: 5px; }
.google-state p { color: var(--muted); font-size: 11px; line-height: 1.55; margin-bottom: 14px; }
@media (max-width: 640px) {
  .field-grid, .email-action { grid-template-columns: 1fr; }
  .email-action :deep(.btn) { width: 100%; justify-content: center; }
  .inline-action { align-items: stretch; flex-direction: column; }
  .inline-action :deep(.btn) { justify-content: center; }
}
</style>
