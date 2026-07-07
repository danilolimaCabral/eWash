import { connect } from 'cloudflare:sockets';

const enc = new TextEncoder();
const b64 = (value) => btoa(value);

export async function sendPasswordResetEmail(env, { to, name, resetUrl }) {
  const username = env.SMTP_USERNAME;
  const password = env.SMTP_PASSWORD;
  if (!username || !password) throw new Error('SMTP is not configured');
  // defense-in-depth: a recipient with whitespace/control chars could smuggle
  // SMTP commands or extra headers — refuse outright
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(to || ''))) {
    throw new Error('Refusing to send: invalid recipient address');
  }

  const socket = connect(
    { hostname: env.SMTP_HOST || 'smtp.gmail.com', port: Number(env.SMTP_PORT || 465) },
    { secureTransport: 'on', allowHalfOpen: false }
  );
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  let buffered = '';

  async function response(expected) {
    while (true) {
      const lines = buffered.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const code = Number(lines[i].slice(0, 3));
          buffered = lines.slice(i + 1).join('\r\n');
          if (!expected.includes(code)) throw new Error(`SMTP rejected request (${code})`);
          return;
        }
      }
      const chunk = await reader.read();
      if (chunk.done) throw new Error('SMTP connection closed unexpectedly');
      buffered += decoder.decode(chunk.value, { stream: true });
    }
  }

  const command = async (text, expected) => {
    await writer.write(enc.encode(`${text}\r\n`));
    await response(expected);
  };

  const fromName = env.EMAIL_FROM_NAME || 'eWash Laundry System';
  const safeName = String(name || 'there').replace(/[<>&]/g, '');
  const subject = 'Reset your eWash password';
  const text = `Hello ${safeName},\n\nReset your eWash password using this link:\n${resetUrl}\n\nThis link expires in 30 minutes and can be used once. If you did not request this, ignore this email.`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#172226;max-width:560px;margin:auto">
    <h2 style="color:#126d67">Reset your eWash password</h2>
    <p>Hello ${safeName},</p>
    <p>Use the button below to choose a new password.</p>
    <p style="margin:24px 0"><a href="${resetUrl}" style="background:#126d67;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600">Reset password</a></p>
    <p style="font-size:13px;color:#6b777b">This link expires in 30 minutes and can be used once. If you did not request it, you can safely ignore this email.</p>
  </div>`;
  const boundary = `ewash-${crypto.randomUUID()}`;
  const message = [
    `From: ${fromName} <${username}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    `--${boundary}--`,
    '',
  ].join('\r\n').replace(/^\./gm, '..');

  try {
    await response([220]);
    await command('EHLO ewash.qesuite.com', [250]);
    await command(`AUTH PLAIN ${b64(`\0${username}\0${password}`)}`, [235]);
    await command(`MAIL FROM:<${username}>`, [250]);
    await command(`RCPT TO:<${to}>`, [250, 251]);
    await command('DATA', [354]);
    await command(`${message}\r\n.`, [250]);
    await command('QUIT', [221]);
  } finally {
    try { writer.releaseLock(); reader.releaseLock(); socket.close(); } catch {}
  }
}
