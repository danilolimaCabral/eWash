<script setup>
// Single source of every icon in the app. Usage: <AppIcon name="orders" :size="18" />
const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 18 },
});

const PATHS = {
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  plus: 'M12 5v14M5 12h14',
  orders: 'M6 2h12v20l-3-2-3 2-3-2-3 2V2ZM9 7h6M9 11h6',
  customers: 'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.6c2 .8 3.5 2.9 3.5 5.4',
  builder: 'M4 8h8M18 8h2M4 16h2M12 16h8M17.5 8m-2.5 0a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M9 16m-2.5 0a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0',
  finance: 'M12 2v20M17 6.5c0-1.9-2.2-3.5-5-3.5S7 4.6 7 6.5s2.2 3.5 5 3.5 5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z',
  chart: 'M4 20V10M10 20V4M16 20v-7M3 20h18',
  search: 'M11 11m-7 0a7 7 0 1 0 14 0 7 7 0 1 0-14 0M20 20l-4-4',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  chevronDown: 'M7 10l5 5 5-5',
  chevronRight: 'M9 18l6-6-6-6',
  send: 'M22 2 11 13M22 2 15 22l-4-9-9-4 20-7Z',
  check: 'M5 13l4 4L19 7',
  checkCircle: 'M5 13l4 4L19 7M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0',
  clock: 'M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0M12 7v5l3 2',
  x: 'M6 6l12 12M18 6L6 18',
  scale: 'M9 6a3 3 0 1 1 6 0M5 6h14l2 14H3L5 6Z',
  shirt: 'M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3a4 4 0 0 1-8 0Z',
  box: 'M3 8l9-5 9 5v8l-9 5-9-5V8ZM3 8l9 5 9-5M12 13v8',
  tiers: 'M4 20v-6M10 20V9M16 20V4M3 20h18',
  branch: 'M4 21V7l8-4 8 4v14M9 21v-5h6v5M8 9h.01M12 9h.01M16 9h.01M8 12h.01M12 12h.01M16 12h.01',
  phone: 'M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2Z',
  cash: 'M2 7h20v10H2zM12 12m-2.5 0a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M5 10h.01M19 14h.01',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.3M21 3v6h-6',
  tag: 'M3 3h8l10 10-8 8L3 11V3ZM7.5 7.5h.01',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  user: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  edit: 'M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2',
  help: 'M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7M12 17h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};
</script>

<template>
  <svg
    :width="size" :height="size" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="PATHS[name] || PATHS.help" />
  </svg>
</template>
