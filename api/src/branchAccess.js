import { and, eq } from 'drizzle-orm';
import { branches } from './db/schema.js';
import { forbidden } from './util.js';

export const isTenantWide = (c) => c.get('user').accessScope === 'tenant';

export function scopedBranchId(c, requestedBranchId = null) {
  const user = c.get('user');
  if (user.accessScope === 'tenant') return requestedBranchId || null;
  if (!user.branchId) forbidden('Your account is not assigned to an active branch');
  if (requestedBranchId && requestedBranchId !== user.branchId) forbidden('You cannot access another branch');
  return user.branchId;
}

export const withBranchScope = (c, column, conditions = []) => {
  const branchId = scopedBranchId(c);
  return and(...conditions, ...(branchId ? [eq(column, branchId)] : []));
};

export function assertBranchAccess(c, branchId) {
  scopedBranchId(c, branchId);
  return branchId;
}

export async function activeBranch(db, tenantId, branchId) {
  const [branch] = await db.select().from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.id, branchId), eq(branches.active, 1)));
  return branch || null;
}
