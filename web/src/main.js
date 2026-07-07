import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router.js';
import { setUnauthorizedHandler, setLoadingHooks } from './api.js';
import { useSession } from './stores/session.js';
import { useLoading } from './stores/loading.js';
import './style.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);

setUnauthorizedHandler(() => {
  const session = useSession();
  if (session.isAuthed) {
    session.logout();
    router.push({ name: 'login' });
  }
});

const loading = useLoading();
setLoadingHooks({ start: () => loading.start(), done: () => loading.done() });

app.mount('#app');
