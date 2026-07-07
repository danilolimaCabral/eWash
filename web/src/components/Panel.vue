<script setup>
defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  flush: { type: Boolean, default: false },
});
</script>

<template>
  <section class="panel" :class="{ flush }">
    <div v-if="title || $slots.actions" class="panel-head">
      <div>
        <h3>{{ title }}</h3>
        <span v-if="subtitle" class="panel-sub">{{ subtitle }}</span>
      </div>
      <div class="panel-actions"><slot name="actions" /></div>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.panel {
  background: #fff; border: 1px solid var(--line); border-radius: 14px;
  padding: 16px 18px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(23,55,45,0.04);
}
.panel.flush { padding-left: 0; padding-right: 0; }
.panel.flush .panel-head { padding-left: 18px; padding-right: 18px; }
.panel-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px; gap: 10px; }
.panel-head h3 { margin: 0 0 2px; font: 700 14.5px var(--font-ui); color: var(--ink); }
.panel-sub { color: var(--muted); font-size: 10.5px; }
.panel-actions { display: flex; gap: 8px; align-items: center; }
@media (max-width: 640px) {
  .panel { padding: 14px; border-radius: 13px; margin-bottom: 12px; }
  .panel.flush .panel-head { padding-left: 14px; padding-right: 14px; }
}
</style>
