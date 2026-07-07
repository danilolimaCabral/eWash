export const money = (cents, currency = 'KES') =>
  `${currency} ${Math.round((cents || 0) / 100).toLocaleString('en-KE')}`;

export const initials = (name) =>
  (name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export const dateTime = (s) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const dateOnly = (s) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const timeAgo = (s) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 60 / 24)}d ago`;
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
  return new Date(y, mo - 1, 1).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
};

export const ORDER_STATUS_LABELS = {
  received: 'Received', washing: 'Washing', ironing: 'Ironing',
  ready: 'Ready', delivered: 'Delivered', void: 'Void',
};

export const PAY_STATUS_LABELS = {
  unpaid: 'Unpaid', partially_paid: 'Partial', paid: 'Paid', refunded: 'Refunded',
};
