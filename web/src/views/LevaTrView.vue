<script setup>
// Leva e Traz: pedidos de coleta feitos pelos clientes finais na página pública.
// A equipe aceita, marca como recolhido e como entregue; o cliente acompanha pelo código.
import { ref, onMounted, watch } from 'vue';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { timeAgo, dateTime } from '../utils/format.js';
import Panel from '../components/Panel.vue';
import Tabs from '../components/Tabs.vue';
import Skeleton from '../components/Skeleton.vue';
import EmptyState from '../components/EmptyState.vue';

const session = useSession();
const toast = useToast();
const tab = ref('novos');
const list = ref(null); // null = first load (skeleton)
const busy = ref(new Set());

const STATUS_LABEL = {
  requested: 'Aguardando',
  accepted: 'Aceito',
  picked_up: 'Recolhido',
  done: 'Entregue',
};

const tabOptions = [
  { key: 'novos', label: 'Novos pedidos' },
  { key: 'em-curso', label: 'Em produção' },
  { key: 'encerrados', label: 'Entregues' },
];

function filterByTab(rows) {
  const map = {
    novos: ['requested'],
    'em-curso': ['accepted', 'picked_up'],
    encerrados: ['done'],
  };
  return (rows || []).filter((r) => map[tab.value].includes(r.status));
}

async function load() {
  try {
    list.value = (await api.get('/levae-traz')).requests;
  } catch (e) {
    toast.error(e.message);
  }
}
onMounted(load);
watch(tab, () => load());

async function changeStatus(req, status) {
  if (busy.value.has(req.id)) return;
  busy.value.add(req.id);
  try {
    await api.patch(`/levae-traz/${req.id}`, { status });
    toast.success(status === 'accepted' ? 'Pedido aceito — cliente notificado' : status === 'picked_up' ? 'Marcado como recolhido' : 'Entrega concluída');
    await load();
  } catch (e) {
    toast.error(e.message);
  } finally {
    busy.value.delete(req.id);
  }
}

function callPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  window.open(`tel:+55${digits}`, '_self');
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>Leva e Traz</h1>
      <p class="page-sub">
        Pedidos de coleta feitos pelos seus clientes na página pública.
        Aceite, recolha e entregue — o cliente acompanha pelo código.
      </p>
    </div>

    <Tabs v-model="tab" :tabs="tabOptions" />

    <Panel>
      <div v-if="list === null" class="skeletons">
        <Skeleton v-for="n in 4" :key="n" class="sk-line" />
      </div>
      <EmptyState
        v-else-if="!filterByTab(list).length"
        icon="truck"
        :title="tab === 'novos' ? 'Nenhum pedido novo' : 'Nada por aqui ainda'"
        :subtitle="tab === 'novos' ? 'Os pedidos feitos pelos clientes na página pública aparecerão aqui automaticamente.' : 'Mova os pedidos avançando as etapas abaixo.'"
      />
      <div v-else class="requests">
        <div v-for="req in filterByTab(list)" :key="req.id" class="req-card" :class="req.status">
          <div class="req-top">
            <div class="req-who">
              <b>{{ req.customer_name }}</b>
              <button class="chip phone" @click="callPhone(req.phone)" title="Ligar para o cliente">
                {{ req.phone }}
              </button>
            </div>
            <span class="req-code">{{ req.access_code }}</span>
          </div>
          <div class="req-items">{{ req.items }}</div>
          <div class="req-meta">
            <span>📍 {{ req.address }}</span>
            <span class="req-time">{{ timeAgo(req.created_at) }}</span>
          </div>
          <div class="req-actions">
            <button
              v-if="req.status === 'requested'"
              class="btn btn-primary" :class="{ busy: busy.has(req.id) }"
              @click="changeStatus(req, 'accepted')"
            >Aceitar pedido</button>
            <button
              v-if="req.status === 'accepted'"
              class="btn btn-primary" :class="{ busy: busy.has(req.id) }"
              @click="changeStatus(req, 'picked_up')"
            >Marcar como recolhido</button>
            <button
              v-if="req.status === 'picked_up'"
              class="btn btn-terracota" :class="{ busy: busy.has(req.id) }"
              @click="changeStatus(req, 'done')"
            >Marcar como entregue</button>
            <span class="req-status-label">{{ STATUS_LABEL[req.status] }}</span>
          </div>
        </div>
      </div>
    </Panel>
  </div>
</template>

<style scoped>
.page-head h1 { font-size: 26px; font-weight: 600; margin-bottom: 4px; }
.page-sub { color: var(--ink-soft, #666); font-size: 14.5px; margin-bottom: 18px; }
.requests { display: flex; flex-direction: column; gap: 12px; }
.req-card {
  border: 1px solid var(--line, #e6dfd4);
  border-radius: 10px;
  padding: 16px 18px;
  background: var(--surface, #fff);
}
.req-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.req-who { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.req-who b { font-size: 15.5px; }
.chip.phone {
  background: none; border: 1px solid var(--line, #e6dfd4); border-radius: 999px;
  padding: 2px 12px; font-size: 12.5px; color: var(--deep, #16453f); cursor: pointer;
  font-family: inherit;
}
.chip.phone:hover { border-color: var(--deep, #16453f); }
.req-code {
  font-family: 'Fraunces', serif; letter-spacing: .18em; font-size: 15px;
  color: var(--ink-soft, #666);
}
.req-items { margin: 8px 0 6px; font-size: 14.5px; color: var(--ink-soft, #666); }
.req-meta { display: flex; gap: 16px; font-size: 13px; color: var(--ink-soft, #8a847c); margin-bottom: 10px; }
.req-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.btn {
  font-family: inherit; font-size: 13.5px; font-weight: 600;
  padding: 9px 18px; border-radius: 8px; border: none; cursor: pointer;
  transition: opacity .2s;
}
.btn.busy { opacity: .6; pointer-events: none; }
.btn-primary { background: var(--deep, #16453f); color: #fff; }
.btn-primary:hover { opacity: .9; }
.btn-terracota { background: var(--terracota, #c4622c); color: #fff; }
.btn-terracota:hover { opacity: .9; }
.req-status-label { font-size: 12.5px; color: var(--ink-soft, #8a847c); margin-left: auto; }
.skeletons { display: flex; flex-direction: column; gap: 14px; padding: 6px 2px; }
.sk-line { height: 16px; }
</style>
