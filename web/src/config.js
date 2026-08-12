export const SUPPORT_EMAIL = 'contato@lavatr.app';

// Shown in the "Need help?" support popup (SupportModal). Edit freely —
// everything here is display-only.
export const SYSTEM_INFO = {
  name: 'LavTr',
  tagline: 'Sistema de Gestão para Lavanderias',
  version: 'v1.0',
  operator: 'LavTr — Lavanderias Inteligentes',
};

export const SUPPORT_CONTACTS = [
  { label: 'E-mail', value: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}`, icon: 'mail' },
  { label: 'WhatsApp / Telefone', value: '+55 11 90000-0000', href: 'tel:+5511900000000', icon: 'phone' },
  { label: 'Website', value: 'lavatr.app', href: 'https://lavatr.app', icon: 'globe' },
];

export const SUPPORT_SOCIALS = [
  { name: 'Instagram', handle: '@lavtr.app', url: 'https://instagram.com/lavtr.app' },
  { name: 'Facebook', handle: 'LavTr', url: 'https://facebook.com/lavtr.app' },
  { name: 'WhatsApp', handle: '+55 11 90000-0000', url: 'https://wa.me/5511900000000' },
];
