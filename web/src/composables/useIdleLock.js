// Locks the app after a period with no user activity (pointer, key, touch,
// scroll). The lock flag persists in localStorage, so refreshing the page
// while locked keeps it locked.
import { onMounted, onBeforeUnmount } from 'vue';
import { useSession } from '../stores/session.js';

export const IDLE_LOCK_MINUTES = 10;

export function useIdleLock() {
  const session = useSession();
  let timer = null;

  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (session.isAuthed && !session.locked) session.lock();
    }, IDLE_LOCK_MINUTES * 60_000);
  };

  const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll'];

  onMounted(() => {
    for (const ev of EVENTS) window.addEventListener(ev, arm, { passive: true });
    arm();
  });
  onBeforeUnmount(() => {
    clearTimeout(timer);
    for (const ev of EVENTS) window.removeEventListener(ev, arm);
  });
}
