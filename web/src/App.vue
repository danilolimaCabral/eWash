<script setup>
import ToastHost from './components/ToastHost.vue';
import LoadingBar from './components/LoadingBar.vue';
</script>

<template>
  <LoadingBar />
  <router-view />
  <ToastHost />
</template>
