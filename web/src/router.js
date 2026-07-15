import { createRouter, createWebHistory } from 'vue-router';
import { useSession } from './stores/session.js';
import { usePlatformSession } from './stores/platformSession.js';

const routes = [
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
  { path: '/reset-password', name: 'reset-password', component: () => import('./views/ResetPasswordView.vue'), meta: { public: true } },
  { path: '/activate', name: 'activate', component: () => import('./views/ActivateAccountView.vue'), meta: { public: true } },
  { path: '/platform/login', name: 'platform-login', component: () => import('./views/PlatformLoginView.vue'), meta: { public: true, platform: true } },
  {
    path: '/platform',
    component: () => import('./views/PlatformShell.vue'),
    meta: { platform: true },
    children: [
      { path: '', name: 'platform-dashboard', component: () => import('./views/PlatformDashboardView.vue'), meta: { platform: true, title: 'Overview' } },
      { path: 'tenants', name: 'platform-tenants', component: () => import('./views/PlatformTenantsView.vue'), meta: { platform: true, title: 'Tenants' } },
      { path: 'revenue', name: 'platform-revenue', component: () => import('./views/PlatformRevenueView.vue'), meta: { platform: true, title: 'Tenant revenue' } },
      { path: 'accounting', name: 'platform-accounting', component: () => import('./views/PlatformAccountingView.vue'), meta: { platform: true, title: 'Accounting' } },
      { path: 'billing', name: 'platform-billing', component: () => import('./views/PlatformBillingView.vue'), meta: { platform: true, title: 'Billing' } },
      { path: 'invoices/:id', name: 'platform-invoice', component: () => import('./views/PlatformInvoiceView.vue'), meta: { platform: true, title: 'Invoice' } },
      { path: 'audit', name: 'platform-audit', component: () => import('./views/PlatformAuditView.vue'), meta: { platform: true, title: 'Audit log' } },
    ],
  },
  {
    path: '/',
    component: () => import('./views/AppShell.vue'),
    children: [
      { path: '', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
      { path: 'orders/new', name: 'new-order', component: () => import('./views/NewOrderView.vue') },
      { path: 'orders', name: 'orders', component: () => import('./views/OrdersBoardView.vue') },
      { path: 'pickups', name: 'pickups', component: () => import('./views/PickupsView.vue') },
      { path: 'customers', name: 'customers', component: () => import('./views/CustomersView.vue') },
      { path: 'builder', name: 'builder', component: () => import('./views/ServiceBuilderView.vue') },
      { path: 'finance', name: 'finance', component: () => import('./views/FinanceView.vue') },
      { path: 'users', name: 'users', component: () => import('./views/UsersRolesView.vue') },
      { path: 'reports', name: 'reports', component: () => import('./views/ReportsView.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

// After a deploy the chunk hashes change; a tab still running the old
// index.js will fail to import the new lazy chunks. Detect that and do a
// one-shot full reload to the target URL so the user silently gets the new
// build instead of a dead click. The sessionStorage guard prevents a loop if
// the reload itself somehow fails.
router.onError((error, to) => {
  const stale = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i
    .test(error?.message || '');
  if (stale && !sessionStorage.getItem('chunk-reload')) {
    sessionStorage.setItem('chunk-reload', '1');
    window.location.assign(to?.fullPath || window.location.pathname);
  }
});
router.afterEach(() => sessionStorage.removeItem('chunk-reload'));

router.beforeEach((to) => {
  const session = useSession();
  const platformSession = usePlatformSession();
  if (to.meta.platform) {
    if (!to.meta.public && !platformSession.isAuthed) return { name: 'platform-login' };
    if (to.name === 'platform-login' && platformSession.isAuthed) return { name: 'platform-dashboard' };
    return true;
  }
  if (!to.meta.public && !session.isAuthed) return { name: 'login' };
  if (to.name === 'login' && session.isAuthed) return { name: 'dashboard' };
  return true;
});
