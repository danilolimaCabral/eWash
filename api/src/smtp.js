import { connect } from 'cloudflare:sockets';

const enc = new TextEncoder();
const b64 = (value) => btoa(value);

async function sendEmail(env, { to, subject, text, html }) {
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

  const command = async (cmdText, expected) => {
    await writer.write(enc.encode(`${cmdText}\r\n`));
    await response(expected);
  };

  const fromName = env.EMAIL_FROM_NAME || 'eWash Laundry System';
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

const safeName = (name) => String(name || 'there').replace(/[<>&]/g, '');

// Shared branded layout for all transactional email: table-based (survives
// Outlook/Gmail), fully inlined styles, responsive via the max-width +
// fluid-table pattern, app palette (--brand #126d67 / --side #0e2424).
const FONT_HEAD = "'Manrope','Segoe UI',system-ui,Arial,sans-serif";
const FONT_BODY = "'DM Sans','Segoe UI',system-ui,Arial,sans-serif";

function renderEmail({ preheader, heading, name, lead, url, button, footnote }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${heading}</title>
<style>
  @media only screen and (max-width: 620px) {
    .container { width: 100% !important; }
    .card-pad { padding: 26px 20px !important; }
    .head-pad { padding: 20px 20px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#eef4f3;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4f3;">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">

        <!-- brand header -->
        <tr><td class="head-pad" style="background:#0e2424;border-radius:16px 16px 0 0;padding:22px 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:40px;height:40px;background:#77d2c3;border-radius:11px;text-align:center;vertical-align:middle;font-family:${FONT_HEAD};font-size:20px;line-height:40px;">🧺</td>
            <td style="padding-left:12px;">
              <span style="font-family:${FONT_HEAD};font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">e<span style="color:#77d2c3;">Wash</span></span><br>
              <span style="font-family:${FONT_BODY};font-size:11px;color:#9db8b4;">Laundry Management SaaS</span>
            </td>
          </tr></table>
        </td></tr>

        <!-- body card -->
        <tr><td class="card-pad" style="background:#ffffff;padding:34px 32px 30px;">
          <h1 style="margin:0 0 14px;font-family:${FONT_HEAD};font-size:21px;font-weight:800;color:#0c5550;letter-spacing:-0.02em;line-height:1.3;">${heading}</h1>
          <p style="margin:0 0 8px;font-family:${FONT_BODY};font-size:14.5px;color:#172226;line-height:1.6;">Hello ${name},</p>
          <p style="margin:0 0 24px;font-family:${FONT_BODY};font-size:14.5px;color:#172226;line-height:1.6;">${lead}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>
            <td style="background:#126d67;border-radius:10px;">
              <a href="${url}" style="display:inline-block;padding:13px 26px;font-family:${FONT_HEAD};font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">${button}</a>
            </td>
          </tr></table>
          <p style="margin:0 0 6px;font-family:${FONT_BODY};font-size:12px;color:#7c898e;line-height:1.6;">If the button doesn't work, copy this link into your browser:</p>
          <p style="margin:0 0 22px;font-family:${FONT_BODY};font-size:12px;line-height:1.6;word-break:break-all;"><a href="${url}" style="color:#126d67;">${url}</a></p>
          <hr style="border:none;border-top:1px solid #e8eeee;margin:0 0 16px;">
          <p style="margin:0;font-family:${FONT_BODY};font-size:12px;color:#7c898e;line-height:1.6;">${footnote}</p>
        </td></tr>

        <!-- footer -->
        <tr><td style="background:#e4f4f1;border-radius:0 0 16px 16px;padding:18px 32px;">
          <p style="margin:0;font-family:${FONT_BODY};font-size:11.5px;color:#4d6360;line-height:1.6;">
            Sent by <b style="font-family:${FONT_HEAD};color:#0c5550;">eWash</b> — laundry operations made simple.<br>
            Need help? <a href="mailto:info@qesuite.com" style="color:#126d67;font-weight:600;">info@qesuite.com</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendPasswordResetEmail(env, { to, name, resetUrl }) {
  const who = safeName(name);
  await sendEmail(env, {
    to,
    subject: 'Reset your eWash password',
    text: `Hello ${who},\n\nReset your eWash password using this link:\n${resetUrl}\n\nThis link expires in 30 minutes and can be used once. If you did not request this, ignore this email.`,
    html: renderEmail({
      preheader: 'Choose a new eWash password — this link expires in 30 minutes.',
      heading: 'Reset your password',
      name: who,
      lead: 'We received a request to reset your eWash password. Use the button below to choose a new one.',
      url: resetUrl,
      button: 'Reset password',
      footnote: 'This link expires in 30 minutes and can be used once. If you did not request it, you can safely ignore this email — your password will not change.',
    }),
  });
}

export async function sendStaffInviteEmail(env, { to, name, business, inviter, inviteUrl }) {
  const who = safeName(name);
  const org = safeName(business);
  const by = safeName(inviter);
  await sendEmail(env, {
    to,
    subject: `You're invited to join ${org} on eWash`,
    text: `Hello ${who},\n\n${by} has invited you to join ${org} on eWash. Accept the invitation and choose your password using this link:\n${inviteUrl}\n\nThis link expires in 72 hours and can be used once. If you were not expecting this, ignore this email.`,
    html: renderEmail({
      preheader: `${by} invited you to join ${org} on eWash — set your password to get started.`,
      heading: `Join ${org} on eWash`,
      name: who,
      lead: `<b>${by}</b> has invited you to join <b>${org}</b>'s team on eWash. Accept the invitation and choose your password to start working with orders, customers and payments.`,
      url: inviteUrl,
      button: 'Accept invitation',
      footnote: 'This link expires in 72 hours and can be used once. If you were not expecting this invitation, you can safely ignore this email.',
    }),
  });
}

export async function sendActivationEmail(env, { to, name, activationUrl }) {
  const who = safeName(name);
  await sendEmail(env, {
    to,
    subject: 'Activate your eWash account',
    text: `Hello ${who},\n\nKaribu to eWash! Activate your account using this link:\n${activationUrl}\n\nThis link expires in 24 hours and can be used once. If you did not sign up, ignore this email.`,
    html: renderEmail({
      preheader: 'One click left — activate your eWash account and go live.',
      heading: 'Karibu! Activate your account',
      name: who,
      lead: 'Your laundry is set up and waiting — a ready-made Kenyan catalog included. Confirm your email to go live and sign in.',
      url: activationUrl,
      button: 'Activate my account',
      footnote: 'This link expires in 24 hours and can be used once. If you did not sign up for eWash, you can safely ignore this email.',
    }),
  });
}
