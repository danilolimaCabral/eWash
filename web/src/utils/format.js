export const money = (cents, currency = 'BRL') => {
  const value = Math.round((cents || 0) / 100);
  if (currency === 'BRL') return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  return `${currency} ${value.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
};

export const initials = (name) =>
  (name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export const dateTime = (s) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const dateOnly = (s) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const timeAgo = (s) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins} min`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)} h`;
  return `${Math.floor(mins / 60 / 24)} d`;
};

const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export const monthNow = () => ym(new Date());

// last n months as YYYY-MM, newest first (local time — no UTC drift)
export const recentMonths = (n = 12) => {
  const d = new Date();
  return Array.from({ length: n }, (_, i) => ym(new Date(d.getFullYear(), d.getMonth() - i, 1)));
};

export const monthLabel = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};

export const ORDER_STATUS_LABELS = {
  received: 'Recebido', washing: 'Lavando', ironing: 'Passando',
  ready: 'Pronto', delivered: 'Entregue', void: 'Cancelado',
};

export const PAY_STATUS_LABELS = {
  unpaid: 'Não pago', partially_paid: 'Parcial', paid: 'Pago', refunded: 'Reembolsado',
};
