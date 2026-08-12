import { auditLog } from './db/schema.js';

export const SUPPORT_EMAIL = 'contato@lavatr.app';

export const uid = () => crypto.randomUUID();

export const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export const today = () => new Date().toISOString().slice(0, 10);

export const monthOf = (dateStr) => (dateStr || today()).slice(0, 7);

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => { throw new ApiError(400, msg); };
export const notFound = (msg = 'Not found') => { throw new ApiError(404, msg); };
export const forbidden = (msg = 'You do not have permission to do this') => { throw new ApiError(403, msg); };

export function fmtMoney(cents, currency = 'BRL') {
  const value = Math.round(cents) / 100;
  if (currency === 'BRL') return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${currency} ${value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function audit(db, tenantId, userId, action, entity, entityId, payload) {
  await db.insert(auditLog).values({
    id: uid(),
    tenantId,
    userId,
    action,
    entity,
    entityId: entityId ?? null,
    payload: payload ? JSON.stringify(payload) : null,
  });
}
