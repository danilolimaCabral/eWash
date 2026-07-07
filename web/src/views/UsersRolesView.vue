<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../api.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';
import { timeAgo } from '../utils/format.js';
import Panel from '../components/Panel.vue';
import Avatar from '../components/Avatar.vue';
import Modal from '../components/Modal.vue';
import FormField from '../components/FormField.vue';
import ToggleSwitch from '../components/ToggleSwitch.vue';
import AppIcon from '../components/AppIcon.vue';
import Skeleton from '../components/Skeleton.vue';

const session = useSession();
const toast = useToast();
const users = ref(null); // null = first load (skeleton)
const roles = ref([]);
const branches = ref([]);
const selectedId = ref(null);
const busy = ref(false);
const inviteOpen = ref(false);
const inviteForm = ref({ name: '', email: '', phone: '', role_id: '', password: '', branch_id: '', access_scope: 'branch' });
const branchesOpen = ref(false);
const branchForm = ref({ id: '', name: '', location: '', active: true });

// pending edits for the selected user
const pendingRole = ref('');
const pendingBranch = ref('');
const pendingScope = ref('branch');
const pendingOverrides = ref({}); // policy_key -> 'grant' | 'deny' (absent = role default)

async function load() {
  try {
    [users.value, roles.value, branches.value] = await Promise.all([api.get('/users'), api.get('/roles'), api.get('/branches')]);
    if (!selectedId.value && users.value.length) select(users.value[0].id);
    else if (selectedId.value) select(selectedId.value);
  } catch (e) { toast.error(e.message); }
}
onMounted(load);

const selected = computed(() => (users.value || []).find((u) => u.id === selectedId.value));
const selectedRole = computed(() => roles.value.find((r) => r.id === pendingRole.value));
const pendingOverrideCount = computed(() => Object.keys(pendingOverrides.value).length);

function select(id) {
  selectedId.value = id;
  const u = (users.value || []).find((x) => x.id === id);
  if (!u) return;
  pendingRole.value = u.roleId;
  pendingBranch.value = u.branchId || '';
  pendingScope.value = u.accessScope || 'branch';
  pendingOverrides.value = { ...u.overrides };
}

function roleDefault(key) {
  return (selectedRole.value?.policies || []).includes(key);
}
function effective(key) {
  const ov = pendingOverrides.value[key];
  if (ov === 'grant') return true;
  if (ov === 'deny') return false;
  return roleDefault(key);
}
function togglePolicy(key, on) {
  if (on === roleDefault(key)) delete pendingOverrides.value[key];
  else pendingOverrides.value[key] = on ? 'grant' : 'deny';
}
function onRoleChange() {
  pendingOverrides.value = {}; // switching template clears overrides (matches API behavior)
  toast.show(`Role template “${selectedRole.value?.name}” applied — overrides cleared on save`);
}

const overrideCount = (u) => Object.keys(u.overrides || {}).length;

async function save() {
  if (!selected.value) return;
  busy.value = true;
  try {
    // send explicit null for keys the user previously had but no longer does
    const overridesPayload = { ...pendingOverrides.value };
    for (const key of Object.keys(selected.value.overrides || {})) {
      if (!(key in overridesPayload)) overridesPayload[key] = null;
    }
    await api.patch(`/users/${selected.value.id}`, {
      role_id: pendingRole.value !== selected.value.roleId ? pendingRole.value : undefined,
      overrides: pendingRole.value !== selected.value.roleId ? pendingOverrides.value : overridesPayload,
      branch_id: pendingBranch.value || undefined,
      access_scope: pendingScope.value,
    });
    toast.success('Saved ✔ — applies at next login · written to audit log');
    await load();
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}

async function toggleActive(u) {
  try {
    await api.patch(`/users/${u.id}`, { status: u.status === 'active' ? 'disabled' : 'active' });
    toast.success(u.status === 'active' ? `${u.name} deactivated` : `${u.name} reactivated`);
    await load();
  } catch (e) { toast.error(e.message); }
}

async function invite() {
  busy.value = true;
  try {
    await api.post('/users', inviteForm.value);
    toast.success(`${inviteForm.value.name} invited — they can sign in with the password you set`);
    inviteOpen.value = false;
    inviteForm.value = { name: '', email: '', phone: '', role_id: roles.value[0]?.id || '', password: '', branch_id: branches.value[0]?.id || '', access_scope: 'branch' };
    await load();
  } catch (e) { toast.error(e.message); }
  finally { busy.value = false; }
}
function editBranch(branch = null) {
  branchForm.value = branch ? { ...branch, active: !!branch.active } : { id: '', name: '', location: '', active: true };
}
async function saveBranch() {
  try {
    if (branchForm.value.id) await api.patch(`/branches/${branchForm.value.id}`, branchForm.value);
    else await api.post('/branches', branchForm.value);
    toast.success(branchForm.value.id ? 'Branch updated' : 'Branch created');
    branchForm.value = { id: '', name: '', location: '', active: true };
    await load();
  } catch (e) { toast.error(e.message); }
}
</script>

<template>
  <div>
    <div class="section-head">
      <div>
        <h2>Users &amp; Roles</h2>
        <p>Role templates + granular per-user overrides · explicit deny beats the role · every change is audit-logged</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" @click="inviteOpen = true; inviteForm.role_id = roles[0]?.id || ''">
          <AppIcon name="plus" :size="14" /> Invite user
        </button>
        <button v-if="session.can('branches.manage')" class="btn btn-outline" @click="branchesOpen = true">Manage branches</button>
      </div>
    </div>

    <div class="users-workspace">
      <Panel class="directory-panel" title="Team" :subtitle="`${users?.length ?? '…'} staff accounts`">
        <Skeleton v-if="!users" variant="list" :count="4" />
        <div v-else class="staff-list">
          <button
            v-for="u in users" :key="u.id"
            class="staff-card" :class="{ selected: u.id === selectedId }"
            :aria-pressed="u.id === selectedId"
            @click="select(u.id)"
          >
            <span class="presence-wrap">
              <Avatar :name="u.name" :size="30" />
              <i class="presence" :class="u.online ? 'online' : 'offline'" :title="u.online ? 'Online now' : 'Offline'" />
            </span>
            <span class="staff-copy">
              <b>{{ u.name }}</b>
              <small v-if="u.status !== 'active'" class="text-red">Deactivated</small>
              <small v-else :class="u.online ? 'text-green' : 'muted'">
                {{ u.online ? 'Online now' : u.lastSeenAt ? `Seen ${timeAgo(u.lastSeenAt)}` : 'Never signed in' }}
              </small>
            </span>
            <span class="staff-role">
              {{ u.roleName }}
              <em v-if="overrideCount(u)">{{ overrideCount(u) }}</em>
            </span>
          </button>
        </div>
      </Panel>

      <Panel v-if="selected" class="editor-panel">
        <div class="user-toolbar">
          <div class="user-identity">
            <span class="presence-wrap">
              <Avatar :name="selected.name" :size="40" />
              <i class="presence large" :class="selected.online ? 'online' : 'offline'" />
            </span>
            <div>
              <div class="identity-line">
                <h3>{{ selected.name }}</h3>
                <span class="status-chip" :class="{ disabled: selected.status !== 'active' }">
                  {{ selected.status === 'active' ? 'Active' : 'Deactivated' }}
                </span>
              </div>
              <p>{{ selected.email }}<template v-if="selected.phone"> · {{ selected.phone }}</template></p>
            </div>
          </div>
          <button v-if="selected.id !== session.user?.id" class="btn btn-ghost btn-sm" @click="toggleActive(selected)">
            {{ selected.status === 'active' ? 'Deactivate' : 'Reactivate' }}
          </button>
        </div>

        <div class="role-strip">
          <FormField label="Role template">
            <select v-model="pendingRole" @change="onRoleChange">
              <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </FormField>
          <FormField label="Access scope"><select v-model="pendingScope"><option value="branch">Assigned branch only</option><option value="tenant">All branches</option></select></FormField>
          <FormField label="Assigned branch"><select v-model="pendingBranch"><option value="">No branch</option><option v-for="b in branches" :key="b.id" :value="b.id">{{ b.name }}</option></select></FormField>
          <div class="role-summary">
            <span>{{ selectedRole?.policies?.length || 0 }}</span>
            <small>role permissions</small>
          </div>
          <div class="role-summary">
            <span>{{ pendingOverrideCount }}</span>
            <small>custom overrides</small>
          </div>
        </div>

        <div class="permissions-head">
          <div>
            <h4>Effective permissions</h4>
            <p>Switches show the access this user will have after saving.</p>
          </div>
          <span class="legend"><i /> Custom override</span>
        </div>

        <div class="permissions-grid">
          <div v-for="p in session.policyCatalog" :key="p.key" class="permission-card"
            :class="{ overridden: pendingOverrides[p.key] }">
            <div class="permission-copy">
              <b>{{ p.label }}</b>
              <small>{{ p.key }}</small>
            </div>
            <span class="default-state">Default: {{ roleDefault(p.key) ? 'Allow' : 'Deny' }}</span>
            <ToggleSwitch :model-value="effective(p.key)" @update:model-value="(v) => togglePolicy(p.key, v)" />
          </div>
        </div>

        <div class="save-row">
          <span class="muted small">Changes apply at next login and are written to the audit log.</span>
          <button class="btn btn-primary" :disabled="busy" @click="save">Save permissions</button>
        </div>
      </Panel>
    </div>

    <Modal v-if="inviteOpen" title="Invite a staff member" @close="inviteOpen = false">
      <div class="row">
        <FormField label="Name"><input v-model="inviteForm.name" type="text" /></FormField>
        <FormField label="Role">
          <select v-model="inviteForm.role_id">
            <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </FormField>
      </div>
      <div class="row">
        <FormField label="Access scope"><select v-model="inviteForm.access_scope"><option value="branch">Assigned branch only</option><option value="tenant">All branches</option></select></FormField>
        <FormField label="Branch"><select v-model="inviteForm.branch_id"><option value="">No branch</option><option v-for="b in branches" :key="b.id" :value="b.id">{{ b.name }}</option></select></FormField>
      </div>
      <div class="row">
        <FormField label="Email"><input v-model="inviteForm.email" type="email" /></FormField>
        <FormField label="Phone"><input v-model="inviteForm.phone" type="tel" /></FormField>
      </div>
      <div class="row">
        <FormField label="Initial password" hint="They should change it after first sign-in.">
          <input v-model="inviteForm.password" type="text" placeholder="min 8 characters" />
        </FormField>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="inviteOpen = false">Cancel</button>
        <button class="btn btn-primary" :disabled="busy" @click="invite">Send invite</button>
      </template>
    </Modal>

    <Modal v-if="branchesOpen" title="Manage branches" wide @close="branchesOpen = false">
      <div class="branch-manager">
        <div class="branch-list">
          <button v-for="branch in branches" :key="branch.id" @click="editBranch(branch)">
            <span><b>{{ branch.name }}</b><small>{{ branch.location || 'No location' }}</small></span>
            <em>{{ branch.active ? 'Active' : 'Deactivated' }}</em>
          </button>
        </div>
        <div class="branch-form">
          <FormField label="Branch name"><input v-model="branchForm.name" /></FormField>
          <FormField label="Location"><input v-model="branchForm.location" /></FormField>
          <FormField v-if="branchForm.id" label="Status"><select v-model="branchForm.active"><option :value="true">Active</option><option :value="false">Deactivated</option></select></FormField>
          <button class="btn btn-primary" :disabled="!branchForm.name.trim()" @click="saveBranch">{{ branchForm.id ? 'Save branch' : 'Create branch' }}</button>
        </div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.users-workspace {
  display: grid; grid-template-columns: 270px minmax(0, 1fr); gap: 14px;
  align-items: stretch; height: calc(100vh - 174px); min-height: 510px;
}
.directory-panel, .editor-panel { min-height: 0; margin-bottom: 0; overflow: hidden; }
.directory-panel { display: flex; flex-direction: column; }
.staff-list { display: flex; flex-direction: column; gap: 6px; min-height: 0; overflow-y: auto; padding-right: 3px; }
.staff-card {
  width: 100%; min-height: 54px; padding: 8px; border: 1px solid transparent; border-radius: 10px;
  background: transparent; color: var(--ink); font-family: inherit; text-align: left; cursor: pointer;
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 9px; align-items: center;
}
.staff-card:hover { background: #f4f8f7; }
.staff-card.selected { background: var(--brand-light); border-color: #b9ddd7; }
.staff-copy { min-width: 0; }
.staff-copy b, .staff-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.staff-copy b { font-size: 12px; }
.staff-copy small { font-size: 9.5px; }
.staff-role { color: var(--muted); font-size: 9.5px; text-align: right; white-space: nowrap; }
.staff-role em {
  display: inline-grid; place-items: center; min-width: 17px; height: 17px; margin-left: 3px;
  border-radius: 50%; background: #fff; color: var(--brand); font-style: normal; font-weight: 700;
}
.editor-panel { display: flex; flex-direction: column; }
.user-toolbar {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  border-bottom: 1px solid var(--line); padding-bottom: 12px;
}
.user-identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
.user-identity h3 { font-size: 15px; margin: 0; }
.user-identity p { color: var(--muted); font-size: 10.5px; overflow-wrap: anywhere; }
.identity-line { display: flex; align-items: center; gap: 7px; }
.status-chip { padding: 2px 7px; border-radius: 999px; background: #e6f5ef; color: var(--green); font-size: 9px; font-weight: 700; }
.status-chip.disabled { background: #fdf0ee; color: var(--red); }
.role-strip {
  display: grid; grid-template-columns: repeat(3, minmax(150px, 1fr)) auto auto; align-items: end;
  gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--line);
}
.role-summary { min-width: 96px; padding: 7px 10px; border-radius: 9px; background: #f5f8f7; }
.role-summary span { display: block; font-size: 15px; font-weight: 700; line-height: 1.1; }
.role-summary small { color: var(--muted); font-size: 9px; }
.branch-manager{display:grid;grid-template-columns:1fr 1fr;gap:14px}.branch-list{display:flex;flex-direction:column;gap:6px;max-height:360px;overflow:auto}.branch-list button{display:flex;justify-content:space-between;align-items:center;padding:10px;border:1px solid var(--line);border-radius:9px;background:#fff;text-align:left;cursor:pointer}.branch-list span,.branch-list small{display:block}.branch-list small{color:var(--muted);font-size:9px}.branch-list em{color:var(--muted);font-size:9px;font-style:normal}.branch-form{display:flex;flex-direction:column;gap:9px}
.permissions-head { display: flex; justify-content: space-between; align-items: end; gap: 10px; padding: 12px 0 8px; }
.permissions-head h4 { font-size: 12.5px; }
.permissions-head p { color: var(--muted); font-size: 9.5px; }
.legend { color: var(--muted); font-size: 9.5px; white-space: nowrap; }
.legend i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); margin-right: 4px; }
.permissions-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px;
  min-height: 0; overflow-y: auto; padding-right: 3px;
}
.permission-card {
  min-height: 49px; display: grid; grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center; gap: 9px; padding: 7px 9px; border: 1px solid var(--line); border-radius: 9px; background: #fff;
}
.permission-card.overridden { border-color: #efc5a9; background: #fffaf7; box-shadow: inset 3px 0 var(--accent); }
.permission-copy { min-width: 0; }
.permission-copy b, .permission-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.permission-copy b { font-size: 11px; }
.permission-copy small { color: var(--muted); font-size: 8.5px; }
.default-state { color: var(--muted); font-size: 8.5px; white-space: nowrap; }
.save-row {
  margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line);
  display: flex; gap: 12px; justify-content: flex-end; align-items: center;
}
.save-row .muted { margin-right: auto; }
.block { display: block; }
.presence-wrap { position: relative; display: inline-flex; flex-shrink: 0; }
.presence {
  position: absolute; right: -1px; bottom: -1px; width: 9px; height: 9px;
  border-radius: 50%; border: 2px solid #fff;
}
.presence.online { background: #2ea272; }
.presence.offline { background: #c3cccb; }
.presence.large { width: 11px; height: 11px; }
@media (max-width: 1100px) {
  .users-workspace { grid-template-columns: 230px minmax(0, 1fr); }
  .default-state { display: none; }
}
@media (max-width: 760px) {
  .users-workspace { display: flex; flex-direction: column; height: auto; min-height: 0; }
  .directory-panel { flex: none; }
  .staff-list { flex-direction: row; overflow-x: auto; padding: 0 0 4px; scroll-snap-type: x mandatory; }
  .staff-card { flex: 0 0 210px; scroll-snap-align: start; }
  .editor-panel { overflow: visible; }
  .permissions-grid { overflow: visible; }
}
@media (max-width: 640px) {
  .section-head p { max-width: 34ch; }
  .user-toolbar { align-items: flex-start; }
  .user-toolbar > .btn { padding: 5px 8px; font-size: 10px; }
  .role-strip { grid-template-columns: 1fr 1fr; }
  .role-strip :deep(.ff) { grid-column: 1 / -1; }
  .role-summary { min-width: 0; }
  .permissions-head { align-items: flex-start; }
  .legend { display: none; }
  .permissions-grid { grid-template-columns: 1fr; }
  .permission-card { min-height: 50px; }
  .default-state { display: inline; }
  .save-row { position: sticky; bottom: 74px; z-index: 5; margin: 10px -4px -4px; padding: 9px; background: rgba(255,255,255,.96); border: 1px solid var(--line); border-radius: 11px; box-shadow: 0 8px 24px rgba(14,36,36,.12); }
  .save-row .muted { display: none; }
  .save-row .btn { width: 100%; justify-content: center; }
}
</style>
