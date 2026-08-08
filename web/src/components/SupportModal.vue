<script setup>
// Support & contact popup opened from the sidebar "Need help?" box.
// All content comes from web/src/config.js — edit it there.
import Modal from './Modal.vue';
import AppIcon from './AppIcon.vue';
import { SYSTEM_INFO, SUPPORT_CONTACTS, SUPPORT_SOCIALS } from '../config.js';

defineEmits(['close']);
</script>

<template>
  <Modal title="Help & support" subtitle="Contact eWash or find product information" @close="$emit('close')">
    <div class="sys-card">
      <span class="sys-mark"><AppIcon name="shirt" :size="20" /></span>
      <div>
        <b>{{ SYSTEM_INFO.name }} <em>{{ SYSTEM_INFO.version }}</em></b>
        <small>{{ SYSTEM_INFO.tagline }} · operated by {{ SYSTEM_INFO.operator }}</small>
      </div>
    </div>

    <h4>Contact support</h4>
    <a v-for="c in SUPPORT_CONTACTS" :key="c.label" class="contact-row" :href="c.href" target="_blank" rel="noopener">
      <span class="c-icon"><AppIcon :name="c.icon" :size="15" /></span>
      <span class="c-copy"><b>{{ c.label }}</b><small>{{ c.value }}</small></span>
      <AppIcon name="chevronRight" :size="14" class="c-go" />
    </a>

    <h4>Find us on social media</h4>
    <div class="socials">
      <a v-for="s in SUPPORT_SOCIALS" :key="s.name" class="social-chip" :href="s.url" target="_blank" rel="noopener">
        <b>{{ s.name }}</b><small>{{ s.handle }}</small>
      </a>
    </div>

    <p class="muted small note">Support hours: Mon–Sat, 8am–6pm EAT. For billing queries mention your business name and invoice number.</p>
  </Modal>
</template>

<style scoped>
.sys-card {
  display: flex; align-items: center; gap: 12px; padding: 13px 14px;
  border-radius: 12px; background: var(--brand-light); margin-bottom: 16px;
}
.sys-mark {
  width: 40px; height: 40px; display: grid; place-items: center;
  border-radius: 11px; background: #77d2c3; color: #0c4d49; flex-shrink: 0;
}
.sys-card b { font: 800 15px var(--font-ui); color: var(--brand-dark); }
.sys-card em { font-style: normal; font-size: 11px; color: var(--muted); font-weight: 600; }
.sys-card small { display: block; color: var(--muted); font-size: 11px; }
h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin: 14px 0 8px; }
.contact-row {
  display: flex; align-items: center; gap: 11px; padding: 9px 10px;
  border: 1px solid var(--line); border-radius: 10px; margin-bottom: 7px;
  color: var(--ink); text-decoration: none;
}
.contact-row:hover { background: #f6f9f8; border-color: #bcd8d4; }
.c-icon {
  width: 30px; height: 30px; display: grid; place-items: center; flex-shrink: 0;
  border-radius: 9px; background: var(--brand-light); color: var(--brand);
}
.c-copy { flex: 1; }
.c-copy b { display: block; font-size: 12.5px; }
.c-copy small { color: var(--muted); font-size: 11px; }
.c-go { color: var(--muted); }
.socials { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.social-chip {
  padding: 9px 11px; border: 1px solid var(--line); border-radius: 10px;
  text-decoration: none; color: var(--ink);
}
.social-chip:hover { background: #f6f9f8; border-color: #bcd8d4; }
.social-chip b { display: block; font-size: 12px; }
.social-chip small { color: var(--brand); font-size: 11px; font-weight: 600; }
.note { margin-top: 14px; }
@media (max-width: 420px) { .socials { grid-template-columns: 1fr; } }
</style>
