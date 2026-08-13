<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from '../stores/session.js';
import { SUPPORT_EMAIL } from '../config.js';
import { useIdleLock } from '../composables/useIdleLock.js';
import AppIcon from '../components/AppIcon.vue';
import Avatar from '../components/Avatar.vue';
import LockScreen from '../components/LockScreen.vue';
import SupportModal from '../components/SupportModal.vue';

const session = useSession();
const route = useRoute();
const router = useRouter();
const drawerOpen = ref(false);
const supportOpen = ref(false);
useIdleLock(); // auto-lock after inactivity — unlock requires the password

const NAV = [
  { label: 'Operação', items: [
    { name: 'dashboard', label: 'Painel', icon: 'grid' },
    { name: 'new-order', label: 'Novo pedido', icon: 'plus', policy: 'orders.create' },
    { name: 'orders', label: 'Pedidos', icon: 'orders' },
    { name: 'pickups', label: 'Coletas', icon: 'checkCircle', policy: 'payments.receive' },
    { name: 'customers', label: 'Clientes', icon: 'customers' },
  ]},
  { label: 'Gerenciar', items: [
    { name: 'builder', label: 'Construtor de Serviços', icon: 'builder', policy: 'catalog.edit' },
    { name: 'finance', label: 'Financeiro / P&L', icon: 'finance', policy: 'finance.view' },
    { name: 'users', label: 'Usuários & Papéis', icon: 'shield', policy: 'users.manage' },
    { name: 'reports', label: 'Relatórios', icon: 'chart', policy: 'finance.view' },
  ]},
];

const visibleNav = computed(() =>
  NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.policy || session.can(i.policy)) }))
     .filter((g) => g.items.length)
);
const flatNav = computed(() => visibleNav.value.flatMap((group) => group.items));
const mobileNav = computed(() => {
  const preferred = ['dashboard', 'orders', 'new-order', 'customers'];
  return preferred.map((name) => flatNav.value.find((item) => item.name === name)).filter(Boolean);
});

const greeting = computed(() => {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 17 ? 'Boa tarde' : 'Boa noite';
});
const todayLabel = new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' });
const branchName = computed(() =>
  session.branches.find((b) => b.id === session.user?.branchId)?.name || session.branches[0]?.name || '');

async function logout() {
  await session.logout();
  router.push({ name: 'login' });
}

watch(() => route.name, () => { drawerOpen.value = false; });

onMounted(async () => {
  if (!session.me) {
    try { await session.loadMe(); }
    catch { logout(); }
  }
});
</script>

<template>
  <div v-if="session.me" class="shell">
    <div v-if="drawerOpen" class="drawer-backdrop" @click="drawerOpen = false" />
    <aside class="side" :class="{ open: drawerOpen }">
      <div class="brand">
        <span class="brand-mark"><AppIcon name="shirt" :size="20" /></span>
        <span>LavTr<small>{{ session.tenant?.name }}</small></span>
      </div>
      <template v-for="group in visibleNav" :key="group.label">
        <div class="nav-label">{{ group.label }}</div>
        <router-link
          v-for="item in group.items" :key="item.name"
          :to="{ name: item.name }" class="nav-link"
          :class="{ active: route.name === item.name }"
        >
          <AppIcon :name="item.icon" :size="17" />{{ item.label }}
        </router-link>
      </template>
      <div class="sidefoot help" role="button" tabindex="0"
        @click="supportOpen = true; drawerOpen = false" @keydown.enter="supportOpen = true; drawerOpen = false">
        <div class="help-icon"><AppIcon name="help" :size="14" /></div>
        <div><strong>Precisa de ajuda?</strong><span>{{ SUPPORT_EMAIL }}</span></div>
      </div>
      <div class="sidefoot" @click="logout">
        <div class="help-icon"><AppIcon name="logout" :size="14" /></div>
        <div><strong>Sair</strong><span>{{ session.user?.email }}</span></div>
      </div>
    </aside>

    <div class="main">
      <header class="apptop">
        <button class="icon-btn burger" aria-label="Menu" @click="drawerOpen = !drawerOpen">
          <span /><span /><span />
        </button>
        <div class="heading">
          <p>{{ todayLabel }}</p>
          <h1>{{ greeting }}, {{ session.user?.name?.split(' ')[0] }} <span>👋</span></h1>
        </div>
        <div class="branch-chip"><AppIcon name="branch" :size="14" />{{ branchName }}</div>
        <div class="profile">
          <Avatar :name="session.user?.name || '?'" :size="34" />
          <div class="profile-text"><strong>{{ session.user?.name }}</strong><small>{{ session.role?.name }}</small></div>
        </div>
      </header>
      <div class="content">
        <router-view />
      </div>
      <nav class="mobile-nav" aria-label="Primary navigation">
        <router-link
          v-for="item in mobileNav" :key="item.name" :to="{ name: item.name }"
          :class="{ active: route.name === item.name }"
        >
          <AppIcon :name="item.icon" :size="19" /><span>{{ item.label.replace('Novo pedido', 'Novo') }}</span>
        </router-link>
        <button :class="{ active: !mobileNav.some((item) => item.name === route.name) }" @click="drawerOpen = true">
          <AppIcon name="more" :size="19" /><span>Mais</span>
        </button>
      </nav>
    </div>
  </div>
  <div v-else class="boot">Loading LavTr…</div>
  <SupportModal v-if="supportOpen" @close="supportOpen = false" />
  <LockScreen v-if="session.isAuthed && session.locked" />
</template>

<style scoped>
.shell { display: flex; min-height: 100vh; }
.boot { display: grid; place-items: center; min-height: 100vh; color: var(--muted); }

.side {
  width: 226px; background: var(--side); padding: 22px 10px 14px; flex-shrink: 0;
  display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; overflow-y: auto;
}
.brand { display: flex; align-items: center; gap: 11px; padding: 0 10px 22px; font: 800 17px var(--font-ui); color: #fff; }
.brand .brand-mark { width: 34px; height: 34px; flex-shrink: 0; display: grid; place-items: center; background: #77d2c3; border-radius: 10px; color: #0c4d49; }
.brand em { color: #7ed7c9; font-style: normal; }
.brand small { display: block; font: 500 9.5px var(--font-ui); color: #687e7b; margin-top: 1px; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-label { margin: 10px 16px 8px; color: #687e7b; font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
.nav-link {
  display: flex; align-items: center; gap: 12px; height: 42px; padding: 0 12px; margin: 2px 6px;
  border-radius: 9px; color: #aebcba; font-weight: 500; font-size: 13.5px; text-decoration: none; position: relative;
}
.nav-link:hover { background: #173331; color: #fff; }
.nav-link.active { background: #1e4642; color: #fff; font-weight: 600; }
.nav-link.active::before { content: ''; position: absolute; left: -6px; top: 10px; width: 3px; height: 22px; background: #6bd0c0; border-radius: 0 5px 5px 0; }
.sidefoot {
  margin: auto 6px 0; padding: 11px 12px; background: #183230; border: 1px solid #244440;
  border-radius: 12px; display: flex; gap: 9px; align-items: center; cursor: pointer;
  text-decoration: none;
}
.sidefoot.help { margin-bottom: 8px; }
.sidefoot + .sidefoot { margin-top: 0; }
.sidefoot:hover { background: #1d3d3a; }
.sidefoot .help-icon { width: 28px; height: 28px; flex-shrink: 0; display: grid; place-items: center; border-radius: 50%; color: #72cbbb; background: #244a46; }
.sidefoot strong { display: block; color: #e6edec; font-size: 11px; }
.sidefoot span { color: #79908d; font-size: 9.5px; word-break: break-all; }

.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.apptop {
  display: flex; align-items: center; gap: 13px; background: #fff;
  border-bottom: 1px solid var(--line); padding: 13px 24px; position: sticky; top: 0; z-index: 30;
}
.heading { margin-right: auto; min-width: 0; }
.heading p { color: #8b969a; font-size: 10.5px; font-weight: 500; margin: 0 0 2px; }
.heading h1 { font: 700 17px var(--font-ui); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.branch-chip {
  display: flex; align-items: center; gap: 7px; height: 36px; padding: 0 13px; border-radius: 9px;
  border: 1px solid #dde4e3; background: #fff; color: #566467; font-size: 11.5px; font-weight: 600; white-space: nowrap;
}
.profile { display: flex; align-items: center; gap: 9px; }
.profile-text strong { font-size: 11px; display: block; }
.profile-text small { color: #8a9699; font-size: 9px; }

.burger { display: none; border: 1px solid var(--line); background: #fff; border-radius: 9px; width: 38px; height: 38px; cursor: pointer; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
.burger span { display: block; width: 16px; height: 2px; background: var(--ink); border-radius: 2px; }

.content { padding: 22px 26px; flex: 1; }
.drawer-backdrop { display: none; }
.mobile-nav { display: none; }

@media (max-width: 980px) {
  .side { position: fixed; left: 0; top: 0; z-index: 60; transform: translateX(-100%); transition: transform 0.22s ease; box-shadow: 8px 0 40px rgba(0,0,0,0.25); }
  .side.open { transform: none; }
  .drawer-backdrop { display: block; position: fixed; inset: 0; background: rgba(10,28,26,0.45); z-index: 55; }
  .burger { display: flex; }
  .branch-chip { display: none; }
  .profile-text { display: none; }
  .content { padding: 16px 14px; }
  .apptop { padding: 10px 14px; }
}
@media (max-width: 640px) {
  .content { padding: 14px 12px 88px; }
  .mobile-nav {
    display: grid; grid-template-columns: repeat(5, 1fr); position: fixed; z-index: 45;
    left: 10px; right: 10px; bottom: calc(8px + env(safe-area-inset-bottom));
    min-height: 62px; padding: 7px 5px; background: rgba(255,255,255,.96);
    border: 1px solid var(--line); border-radius: 17px; box-shadow: 0 12px 36px rgba(14,36,36,.18);
    backdrop-filter: blur(14px);
  }
  .mobile-nav a, .mobile-nav button {
    border: 0; background: none; color: var(--muted); text-decoration: none; font: 600 9px var(--font-ui);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-width: 0;
  }
  .mobile-nav a.active, .mobile-nav button.active { color: var(--brand); }
  .mobile-nav a.active svg, .mobile-nav button.active svg { filter: drop-shadow(0 3px 4px rgba(18,109,103,.18)); }
  .heading p { display: none; }
  .heading h1 { font-size: 15px; }
}
</style>
