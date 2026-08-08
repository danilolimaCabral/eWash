<script setup>
import { computed, onMounted, ref } from 'vue';
import DataTable from '../components/DataTable.vue';
import FormField from '../components/FormField.vue';
import Modal from '../components/Modal.vue';
import Panel from '../components/Panel.vue';
import StatusBadge from '../components/StatusBadge.vue';
import Tabs from '../components/Tabs.vue';
import AppSelect from '../components/AppSelect.vue';
import { platformApi } from '../platformApi.js';
import { dateOnly, money } from '../utils/format.js';
import { useToast } from '../stores/toast.js';

const toast = useToast();
const rows = ref([]);
const total = ref(0);
const offset = ref(0);
const limit = 10;
const q = ref('');
const status = ref('');
const error = ref('');
const selected = ref(null);
const detail = ref(null);
const detailTab = ref('overview');
const plans = ref([]);
const action = ref({ open: false, status: 'suspended', reason: '' });
const subscription = ref({ plan_id: '', status: 'active', term_months: 1, custom_price: '' });
const memberData = ref({ rows: [], total: 0, roles: [], branches: [] });
const memberOffset = ref(0);
const memberLimit = 10;
const memberQ = ref('');
const memberStatus = ref('');
const memberModal = ref('');
const memberForm = ref({ id: '', name: '', email: '', phone: '', role_id: '', branch_id: '', access_scope: 'branch', status: 'active', reason: '' });
const billingEdit = ref(false);
const billingEmail = ref('');
const branchData = ref({ rows: [], total: 0 });
const branchOffset = ref(0);
const branchModal = ref('');
const branchForm = ref({ id: '', name: '', location: '', active: true, reason: '' });

const columns = [
  { key: 'name', label: 'Business' }, { key: 'plan', label: 'Plan' },
  { key: 'branches', label: 'Branches', align: 'right' }, { key: 'users', label: 'Users', align: 'right' },
  { key: 'outstanding', label: 'Outstanding', align: 'right' }, { key: 'status', label: 'Status' },
  { key: 'createdAt', label: 'Joined' },
];

async function load(nextOffset = 0) {
  offset.value = nextOffset;
  error.value = '';
  try {
    const params = new URLSearchParams({ limit, offset: nextOffset });
    if (q.value) params.set('q', q.value);
    if (status.value) params.set('status', status.value);
    const result = await platformApi.get(`/tenants?${params}`);
    rows.value = result.rows;
    total.value = result.total;
  } catch (e) { error.value = e.message; }
}
async function openTenant(row) {
  selected.value = row;
  detail.value = await platformApi.get(`/tenants/${row.id}`);
  detailTab.value = 'overview';
  const current = detail.value.subscriptions[0];
  subscription.value = {
    plan_id: current?.planId || plans.value.find((p) => p.code === detail.value.tenant.plan)?.id || '',
    status: current?.status || 'active',
    term_months: current?.termMonths || 1,
    custom_price: current?.customPriceCents == null ? '' : current.customPriceCents / 100,
  };
  billingEmail.value = detail.value.tenant.billingEmail || '';
  billingEdit.value = false;
  await loadMembers(0);
  await loadBranches(0);
}
async function loadBranches(nextOffset = 0) {
  if (!selected.value) return;
  branchOffset.value = nextOffset;
  branchData.value = await platformApi.get(`/tenants/${selected.value.id}/branches?limit=10&offset=${nextOffset}`);
}
function openBranch(branch = null) {
  branchForm.value = branch
    ? { id: branch.id, name: branch.name, location: branch.location || '', active: !!branch.active, reason: '' }
    : { id: '', name: '', location: '', active: true, reason: '' };
  branchModal.value = branch ? 'edit' : 'create';
}
async function saveBranch() {
  try {
    if (branchModal.value === 'create') {
      await platformApi.post(`/tenants/${selected.value.id}/branches`, branchForm.value);
      toast.success('Branch created');
    } else {
      await platformApi.patch(`/tenants/${selected.value.id}/branches/${branchForm.value.id}`, {
        name: branchForm.value.name, location: branchForm.value.location,
        active: branchForm.value.active, reason: branchForm.value.reason,
      });
      toast.success('Branch updated');
    }
    branchModal.value = '';
    await loadBranches(branchOffset.value);
    await openTenant(selected.value);
    detailTab.value = 'branches';
    await load(offset.value);
  } catch (e) { toast.error(e.message); }
}
async function saveBillingEmail() {
  try {
    const tenant = await platformApi.patch(`/tenants/${selected.value.id}/billing`, { billing_email: billingEmail.value });
    detail.value.tenant = tenant;
    billingEdit.value = false;
    await load(offset.value);
    toast.success(billingEmail.value ? 'Billing email updated' : 'Billing email cleared');
  } catch (e) { toast.error(e.message); }
}
async function loadMembers(nextOffset = 0) {
  if (!selected.value) return;
  memberOffset.value = nextOffset;
  const params = new URLSearchParams({ limit: memberLimit, offset: nextOffset });
  if (memberQ.value) params.set('q', memberQ.value);
  if (memberStatus.value) params.set('status', memberStatus.value);
  memberData.value = await platformApi.get(`/tenants/${selected.value.id}/members?${params}`);
}
function openCreateMember() {
  memberForm.value = {
    id: '', name: '', email: '', phone: '',
    role_id: memberData.value.roles.find((role) => role.name === 'Attendant')?.id || memberData.value.roles[0]?.id || '',
    branch_id: memberData.value.branches[0]?.id || '', access_scope: 'branch', status: 'active', reason: '',
  };
  memberModal.value = 'create';
}
function openEditMember(member) {
  memberForm.value = {
    id: member.id, name: member.name, email: member.email, phone: member.phone || '',
    role_id: member.roleId, branch_id: member.branchId || '', access_scope: member.accessScope || 'branch', status: member.status, reason: '',
  };
  memberModal.value = 'edit';
}
async function saveMember() {
  try {
    if (memberModal.value === 'create') {
      const created = await platformApi.post(`/tenants/${selected.value.id}/members`, {
        name: memberForm.value.name, email: memberForm.value.email, phone: memberForm.value.phone,
        role_id: memberForm.value.role_id, branch_id: memberForm.value.branch_id || null, access_scope: memberForm.value.access_scope,
      });
      toast.success(created.emailSent ? 'Member created and password reset link sent' : 'Member created, but the email could not be sent');
    } else {
      await platformApi.patch(`/tenants/${selected.value.id}/members/${memberForm.value.id}`, {
        role_id: memberForm.value.role_id, branch_id: memberForm.value.branch_id || null, access_scope: memberForm.value.access_scope,
        status: memberForm.value.status, reason: memberForm.value.reason,
      });
      toast.success('Tenant member updated');
    }
    memberModal.value = '';
    await loadMembers(memberOffset.value);
    await load(offset.value);
  } catch (e) { toast.error(e.message); }
}
async function sendReset(member) {
  try {
    await platformApi.post(`/tenants/${selected.value.id}/members/${member.id}/reset-password`);
    toast.success(`Password reset link sent to ${member.email}`);
  } catch (e) { toast.error(e.message); }
}
async function changeStatus() {
  await platformApi.patch(`/tenants/${selected.value.id}/status`, action.value);
  action.value.open = false;
  await load(offset.value);
  await openTenant(selected.value);
}
async function saveSubscription() {
  await platformApi.put(`/tenants/${selected.value.id}/subscription`, {
    plan_id: subscription.value.plan_id,
    status: subscription.value.status,
    term_months: subscription.value.term_months,
    custom_price_cents: subscription.value.custom_price === '' ? null : Math.round(Number(subscription.value.custom_price) * 100),
  });
  await openTenant(selected.value);
  await load(offset.value);
}
// terms configured for the currently chosen plan (label: "3 months — KES 3,500/mo")
const planTerms = computed(() => plans.value.find((p) => p.id === subscription.value.plan_id)?.prices || []);
function onPlanChange() {
  if (!planTerms.value.some((t) => t.termMonths === subscription.value.term_months)) {
    subscription.value.term_months = planTerms.value[0]?.termMonths || 1;
  }
}
onMounted(async () => {
  [plans.value] = await Promise.all([platformApi.get('/plans'), load()]);
});
</script>

<template>
  <Panel title="Tenants" subtitle="Businesses and tenancy lifecycle">
    <template #actions>
      <div class="filters">
        <input v-model="q" type="search" placeholder="Search business or email" @keyup.enter="load(0)" />
        <AppSelect v-model="status" compact @change="load(0)"><option value="">All statuses</option><option>active</option><option>suspended</option><option>cancelled</option></AppSelect>
        <button class="btn btn-outline btn-sm" @click="load(0)">Search</button>
      </div>
    </template>
    <p v-if="error" class="error-text">{{ error }}</p>
    <DataTable :columns="columns" :page="{ rows, total, limit, offset }" clickable @page="load" @row-click="openTenant">
      <template #cell-name="{ row }"><b>{{ row.name }}</b><small>{{ row.billingEmail || 'No billing email' }}</small></template>
      <template #cell-outstanding="{ row }"><b>{{ money(row.outstandingCents) }}</b></template>
      <template #cell-status="{ row }"><StatusBadge :status="row.status" kind="generic" /></template>
      <template #cell-createdAt="{ row }">{{ dateOnly(row.createdAt) }}</template>
    </DataTable>
  </Panel>

  <Modal v-if="detail" :title="detail.tenant.name" subtitle="Tenant profile, subscription, branches, invoices, and members" size="workspace" @close="detail = null">
    <Tabs v-model="detailTab" :tabs="[
      { key: 'overview', label: 'Overview' }, { key: 'branches', label: 'Branches', count: branchData.total }, { key: 'subscription', label: 'Subscription' },
      { key: 'invoices', label: 'Invoices', count: detail.invoices.length }, { key: 'users', label: 'Members', count: memberData.total },
    ]" />
    <div v-if="detailTab === 'overview'" class="detail-grid">
      <div><span>Status</span><StatusBadge :status="detail.tenant.status" kind="generic" /></div>
      <div v-if="detail.tenant.status === 'active' && detail.tenant.cancelledAt"><span>Cancellation scheduled</span><b>{{ dateOnly(detail.tenant.cancelledAt) }}</b></div>
      <div><span>Plan</span><b>{{ detail.tenant.plan }}</b></div>
      <div class="billing-card">
        <span>Billing email</span>
        <template v-if="billingEdit">
          <input v-model="billingEmail" type="email" placeholder="billing@example.com" @keyup.enter="saveBillingEmail" />
          <div class="billing-actions"><button @click="saveBillingEmail">Save</button><button @click="billingEdit = false; billingEmail = detail.tenant.billingEmail || ''">Cancel</button></div>
        </template>
        <template v-else><b>{{ detail.tenant.billingEmail || 'Not set' }}</b><button class="edit-link" @click="billingEdit = true">Edit</button></template>
      </div>
      <div><span>Branches</span><b>{{ detail.branches.length }}</b></div>
    </div>
    <div v-else-if="detailTab === 'branches'" class="members">
      <div class="member-tools"><button class="btn btn-primary btn-sm" @click="openBranch()">+ Add branch</button></div>
      <DataTable :columns="[{key:'name',label:'Branch'},{key:'users',label:'Active users',align:'right'},{key:'openOrders',label:'Open orders',align:'right'},{key:'active',label:'Status'},{key:'actions',label:'Actions'}]" :page="{ rows: branchData.rows, total: branchData.total, limit: 10, offset: branchOffset }" @page="loadBranches">
        <template #cell-name="{ row }"><b>{{ row.name }}</b><small>{{ row.location || 'No location' }}</small></template>
        <template #cell-active="{ row }"><StatusBadge :status="row.active ? 'active' : 'disabled'" kind="generic" /></template>
        <template #cell-actions="{ row }"><div class="inline-actions"><button @click="openBranch(row)">Manage</button></div></template>
      </DataTable>
    </div>
    <div v-else-if="detailTab === 'subscription'" class="subscription-form">
      <FormField label="Plan"><AppSelect v-model="subscription.plan_id" @change="onPlanChange"><option v-for="plan in plans" :key="plan.id" :value="plan.id">{{ plan.name }}</option></AppSelect></FormField>
      <FormField label="Billing term" hint="Longer commitments get the lower per-month rate">
        <AppSelect v-model="subscription.term_months">
          <option v-for="t in planTerms" :key="t.termMonths" :value="t.termMonths">{{ t.termMonths }} {{ t.termMonths === 1 ? 'month' : 'months' }} — {{ money(t.priceCents, 'KES') }}/mo</option>
        </AppSelect>
      </FormField>
      <FormField label="Subscription status"><AppSelect v-model="subscription.status"><option>trial</option><option>active</option><option>past_due</option><option>suspended</option><option>cancelled</option></AppSelect></FormField>
      <FormField label="Custom price per month (KES)" hint="Leave blank to use the plan's term rate"><input v-model="subscription.custom_price" type="number" min="0" step="1" /></FormField>
      <button class="btn btn-primary" @click="saveSubscription">Save subscription</button>
    </div>
    <DataTable v-else-if="detailTab === 'invoices'" :columns="[{key:'number',label:'Invoice'},{key:'status',label:'Status'},{key:'totalCents',label:'Total',align:'right'},{key:'dueAt',label:'Due'}]" :rows="detail.invoices">
      <template #cell-status="{ row }"><StatusBadge :status="row.status" kind="generic" /></template><template #cell-totalCents="{ row }">{{ money(row.totalCents) }}</template><template #cell-dueAt="{ row }">{{ dateOnly(row.dueAt) }}</template>
    </DataTable>
    <div v-else class="members">
      <div class="member-tools">
        <input v-model="memberQ" type="search" placeholder="Search members" @keyup.enter="loadMembers(0)" />
        <AppSelect v-model="memberStatus" compact @change="loadMembers(0)"><option value="">All statuses</option><option value="active">Active</option><option value="disabled">Disabled</option></AppSelect>
        <button class="btn btn-outline btn-sm" @click="loadMembers(0)">Search</button>
        <button class="btn btn-primary btn-sm" @click="openCreateMember">+ Add member</button>
      </div>
      <DataTable :columns="[{key:'name',label:'Member'},{key:'roleName',label:'Role'},{key:'branchName',label:'Branch'},{key:'status',label:'Status'},{key:'actions',label:'Actions'}]" :page="{ rows: memberData.rows, total: memberData.total, limit: memberLimit, offset: memberOffset }" @page="loadMembers">
        <template #cell-name="{ row }"><b>{{ row.name }}</b><small>{{ row.email }}</small></template>
        <template #cell-branchName="{ row }">{{ row.branchName || 'All branches' }}</template>
        <template #cell-status="{ row }"><StatusBadge :status="row.status" kind="generic" /></template>
        <template #cell-actions="{ row }"><div class="inline-actions"><button @click="openEditMember(row)">Manage</button><button :disabled="row.status !== 'active'" @click="sendReset(row)">Reset password</button></div></template>
      </DataTable>
    </div>
    <template #footer>
      <button v-if="detail.tenant.status !== 'active'" class="btn btn-outline" @click="action = { open: true, status: 'active', reason: 'Reactivated by platform administrator' }">Reactivate</button>
      <button v-if="detail.tenant.status === 'active'" class="btn btn-outline" @click="action = { open: true, status: 'suspended', reason: '' }">Suspend</button>
      <button v-if="detail.tenant.status !== 'cancelled' && !detail.tenant.cancelledAt" class="btn btn-danger" @click="action = { open: true, status: 'cancelled', reason: '' }">Cancel tenancy</button>
    </template>
  </Modal>

  <Modal v-if="action.open" :title="action.status === 'cancelled' ? 'Cancel tenancy' : action.status === 'suspended' ? 'Suspend tenant' : 'Reactivate tenant'" subtitle="Review the effect and provide an audit reason." @close="action.open = false">
    <p class="muted">This action is immediate and will be recorded in the platform audit log.</p>
    <FormField label="Reason"><textarea v-model="action.reason" rows="3" required /></FormField>
    <template #footer><button class="btn btn-outline" @click="action.open = false">Back</button><button class="btn btn-primary" :disabled="!action.reason.trim()" @click="changeStatus">Confirm</button></template>
  </Modal>

  <Modal v-if="memberModal" :title="memberModal === 'create' ? 'Add tenant member' : 'Manage tenant member'" subtitle="Set identity, role, branch access, and account status." @close="memberModal = ''">
    <div class="member-form">
      <FormField label="Name"><input v-model="memberForm.name" type="text" :disabled="memberModal === 'edit'" required /></FormField>
      <FormField label="Email"><input v-model="memberForm.email" type="email" :disabled="memberModal === 'edit'" required /></FormField>
      <FormField v-if="memberModal === 'create'" label="Phone"><input v-model="memberForm.phone" type="tel" /></FormField>
      <FormField label="Role"><AppSelect v-model="memberForm.role_id"><option v-for="role in memberData.roles" :key="role.id" :value="role.id">{{ role.name }}</option></AppSelect></FormField>
      <FormField label="Access scope"><AppSelect v-model="memberForm.access_scope"><option value="branch">Assigned branch only</option><option value="tenant">All tenant branches</option></AppSelect></FormField>
      <FormField label="Branch"><AppSelect v-model="memberForm.branch_id"><option value="">All branches</option><option v-for="branch in memberData.branches" :key="branch.id" :value="branch.id">{{ branch.name }}</option></AppSelect></FormField>
      <FormField v-if="memberModal === 'edit'" label="Status"><AppSelect v-model="memberForm.status"><option value="active">Active</option><option value="disabled">Deactivated</option></AppSelect></FormField>
    </div>
    <FormField v-if="memberModal === 'edit'" label="Reason" hint="Required for a clear audit trail"><textarea v-model="memberForm.reason" rows="2" /></FormField>
    <p v-else class="muted small">The member will receive a secure link to choose their password.</p>
    <template #footer><button class="btn btn-outline" @click="memberModal = ''">Cancel</button><button class="btn btn-primary" :disabled="!memberForm.name || !memberForm.email || !memberForm.role_id || (memberModal === 'edit' && !memberForm.reason.trim())" @click="saveMember">{{ memberModal === 'create' ? 'Create & send link' : 'Save changes' }}</button></template>
  </Modal>

  <Modal v-if="branchModal" :title="branchModal === 'create' ? 'Add tenant branch' : 'Manage tenant branch'" subtitle="Maintain the location and availability of this branch." @close="branchModal = ''">
    <div class="member-form">
      <FormField label="Branch name"><input v-model="branchForm.name" required /></FormField>
      <FormField label="Location"><input v-model="branchForm.location" /></FormField>
      <FormField v-if="branchModal === 'edit'" label="Status"><AppSelect v-model="branchForm.active"><option :value="true">Active</option><option :value="false">Deactivated</option></AppSelect></FormField>
    </div>
    <FormField v-if="branchModal === 'edit'" label="Reason"><textarea v-model="branchForm.reason" rows="2" /></FormField>
    <p v-if="branchModal === 'edit' && !branchForm.active" class="muted small">Deactivation is blocked until active users are reassigned and open orders are completed.</p>
    <template #footer><button class="btn btn-outline" @click="branchModal = ''">Cancel</button><button class="btn btn-primary" :disabled="!branchForm.name.trim() || (branchModal === 'edit' && !branchForm.reason.trim())" @click="saveBranch">Save branch</button></template>
  </Modal>
</template>

<style scoped>
.filters{display:flex;gap:7px}.filters input{min-width:210px}.filters input,.filters select{height:34px;padding:0 9px;border:1px solid var(--line);border-radius:8px;font:inherit}small{display:block;color:var(--muted);font-size:9.5px;margin-top:2px}.detail-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.detail-grid>div{padding:12px;border:1px solid var(--line);border-radius:10px}.detail-grid span{display:block;color:var(--muted);font-size:10px;margin-bottom:4px}.subscription-form{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.subscription-form button{align-self:end;justify-self:start}textarea{width:100%;resize:vertical}
.member-tools{display:flex;gap:7px;margin-bottom:10px}.member-tools input,.member-tools select{height:34px;padding:0 9px;border:1px solid var(--line);border-radius:8px;font:inherit}.member-tools input{min-width:180px}.member-tools .btn-primary{margin-left:auto}.inline-actions{display:flex;gap:8px}.inline-actions button{padding:0;border:0;background:none;color:var(--brand);font:600 10px var(--font-ui);cursor:pointer}.inline-actions button:disabled{color:var(--muted);cursor:not-allowed}.member-form{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
:deep(.data-table th){padding-top:7px;padding-bottom:7px}:deep(.data-table td){padding-top:8px;padding-bottom:8px}.members :deep(.pager){padding-top:8px}
.billing-card input{width:100%;height:34px;margin-top:3px;padding:0 9px;border:1px solid var(--line);border-radius:8px;font:inherit}.edit-link,.billing-actions button{padding:0;border:0;background:none;color:var(--brand);font:600 10px var(--font-ui);cursor:pointer}.edit-link{display:block;margin-top:5px}.billing-actions{display:flex;gap:10px;margin-top:6px}
@media(max-width:700px){.filters{width:100%;flex-wrap:wrap}.filters input{min-width:0;flex:1}.detail-grid,.subscription-form{grid-template-columns:1fr}}
@media(max-width:640px){:deep(.panel-head){display:block}.filters{margin-top:10px}.filters input{flex-basis:100%}.member-tools{flex-wrap:wrap}.member-tools input{min-width:0;flex:1}.member-tools .btn-primary{margin-left:0}.member-form{grid-template-columns:1fr}}
</style>
