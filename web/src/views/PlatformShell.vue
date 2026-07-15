<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '../components/AppIcon.vue';
import Avatar from '../components/Avatar.vue';
import { usePlatformSession } from '../stores/platformSession.js';

const session = usePlatformSession();
const route = useRoute();
const router = useRouter();
const drawer = ref(false);
const nav = computed(() => [
  { name: 'platform-dashboard', label: 'Overview', icon: 'grid', policy: 'platform.dashboard.view' },
  { name: 'platform-tenants', label: 'Tenants', icon: 'branch', policy: 'platform.tenants.view' },
  { name: 'platform-revenue', label: 'Revenue', icon: 'chart', policy: 'platform.billing.view' },
  { name: 'platform-accounting', label: 'Accounting', icon: 'scale', policy: 'platform.billing.view' },
  { name: 'platform-billing', label: 'Billing', icon: 'finance', policy: 'platform.billing.view' },
  { name: 'platform-audit', label: 'Audit log', icon: 'history', policy: 'platform.audit.view' },
].filter((item) => session.can(item.policy)));

async function logout() {
  await session.logout();
  router.push({ name: 'platform-login' });
}
watch(() => route.name, () => { drawer.value = false; });
onMounted(async () => {
  if (!session.me) {
    try { await session.loadMe(); } catch { logout(); }
  }
});
</script>

<template>
  <div v-if="session.me" class="shell">
    <div v-if="drawer" class="backdrop" @click="drawer = false" />
    <aside :class="{ open: drawer }">
      <div class="brand"><span><AppIcon name="shield" :size="19" /></span><div>e<em>Wash</em><small>Control Centre</small></div></div>
      <div class="nav-label">Platform</div>
      <router-link v-for="item in nav" :key="item.name" :to="{ name: item.name }" :class="{ active: route.name === item.name }">
        <AppIcon :name="item.icon" :size="17" />{{ item.label }}
      </router-link>
      <button class="signout" @click="logout"><AppIcon name="logout" :size="15" /><span><b>Sign out</b><small>{{ session.user?.email }}</small></span></button>
    </aside>
    <section class="main">
      <header>
        <button class="burger" aria-label="Open menu" @click="drawer = true">☰</button>
        <div><small>Platform administration</small><h1>{{ route.meta.title || 'Control Centre' }}</h1></div>
        <div class="profile">
          <Avatar :name="session.user?.name || 'Platform'" :size="36" />
          <span class="profile-text">
            <b>{{ session.user?.name }}</b>
            <small>{{ session.user?.email }}</small>
          </span>
          <span class="role-pill">{{ (session.user?.role || '').replaceAll('_', ' ') }}</span>
        </div>
      </header>
      <main><router-view /></main>
      <nav class="mobile-nav">
        <router-link v-for="item in nav.slice(0, 4)" :key="item.name" :to="{ name: item.name }" :class="{ active: route.name === item.name }">
          <AppIcon :name="item.icon" :size="19" /><span>{{ item.label }}</span>
        </router-link>
      </nav>
    </section>
  </div>
  <div v-else class="boot">Loading control centre…</div>
</template>

<style scoped>
.shell { display: flex; min-height: 100vh; }.boot { min-height: 100vh; display: grid; place-items: center; color: var(--muted); }
aside { width: 226px; height: 100vh; position: sticky; top: 0; flex: 0 0 auto; display: flex; flex-direction: column; padding: 22px 10px 14px; background: var(--side); }
.brand { display: flex; align-items: center; gap: 11px; padding: 0 10px 24px; color: #fff; font: 800 17px var(--font-ui); }
.brand > span { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 10px; background: #77d2c3; color: #0c4d49; }.brand em { color: #7ed7c9; font-style: normal; }.brand small { display: block; color: #78908d; font: 500 9px var(--font-ui); }
.nav-label { margin: 8px 16px; color: #687e7b; font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
aside > a { display: flex; align-items: center; gap: 12px; height: 42px; margin: 2px 6px; padding: 0 12px; border-radius: 9px; color: #aebcba; font-size: 13px; text-decoration: none; }
aside > a:hover, aside > a.active { color: #fff; background: #1e4642; }
.signout { margin: auto 6px 0; padding: 11px 12px; display: flex; align-items: center; gap: 10px; border: 1px solid #244440; border-radius: 12px; background: #183230; color: #e6edec; text-align: left; cursor: pointer; }.signout span,.signout small { display: block; }.signout small { max-width: 150px; overflow: hidden; color: #79908d; font-size: 9px; text-overflow: ellipsis; }
.main { flex: 1; min-width: 0; }header { height: 66px; position: sticky; top: 0; z-index: 30; display: flex; align-items: center; gap: 12px; padding: 0 24px; border-bottom: 1px solid var(--line); background: #fff; }
header > div:first-of-type { margin-right: auto; }header small { display: block; color: var(--muted); font-size: 9.5px; }header h1 { margin: 1px 0 0; font: 700 17px var(--font-ui); }
.profile { display: flex; align-items: center; gap: 10px; padding: 5px 12px 5px 6px; border: 1px solid var(--line); border-radius: 999px; background: #fbfdfc; }
.profile-text { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
.profile-text b { font: 600 12.5px var(--font-ui); color: var(--ink); }
.profile-text small { color: var(--muted); font-size: 10.5px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.role-pill { padding: 2px 9px; border-radius: 999px; background: var(--brand-light, #e4f4f1); color: var(--brand-dark, #0c5550); font: 700 9.5px var(--font-ui); text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
main { padding: 22px 26px; }.burger { display: none; border: 0; background: none; font-size: 20px; }.backdrop,.mobile-nav { display: none; }
@media(max-width:980px){aside{position:fixed;z-index:60;transform:translateX(-100%);transition:.2s}aside.open{transform:none}.backdrop{display:block;position:fixed;inset:0;z-index:55;background:#0a1c1a73}.burger{display:block}main{padding:16px 14px}}
@media(max-width:640px){header{height:58px;padding:0 12px}.profile{padding:0;border:0;background:none}.profile-text,.role-pill{display:none}main{padding:14px 12px 84px}.mobile-nav{display:grid;grid-template-columns:repeat(4,1fr);position:fixed;z-index:45;left:10px;right:10px;bottom:calc(8px + env(safe-area-inset-bottom));min-height:62px;padding:7px;background:#fffffff5;border:1px solid var(--line);border-radius:17px;box-shadow:0 12px 36px #0e24242e}.mobile-nav a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--muted);font-size:9px;text-decoration:none}.mobile-nav a.active{color:var(--brand)}}
</style>
