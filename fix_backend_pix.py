import pathlib

# --- routes/orders.js ---
p = pathlib.Path('api/src/routes/orders.js')
t = p.read_text()
t = t.replace("if (body.payment.method !== 'cash' && !cleanStr(body.payment.mpesa_ref, 40, 'M-Pesa code')) {",
              "if (body.payment.method !== 'cash' && !cleanStr(body.payment.pix_ref, 40, 'Código Pix')) {")
t = t.replace("const method = body.payment.method === 'cash' ? 'cash' : 'mpesa_manual';",
              "const method = body.payment.method === 'cash' ? 'cash' : 'pix_manual';")
t = t.replace("const ref = cleanStr(body.payment.mpesa_ref, 40, 'M-Pesa code');",
              "const ref = cleanStr(body.payment.pix_ref, 40, 'Código Pix');")
t = t.replace("if (method === 'mpesa_manual' && !ref) bad('M-Pesa code is required');",
              "if (method === 'pix_manual' && !ref) bad('Código Pix é obrigatório');")
t = t.replace("mpesaRef: ref || null, status: 'completed', receivedBy: user.id,",
              "pixRef: ref || null, status: 'completed', receivedBy: user.id,")
p.write_text(t)

# --- routes/finance.js ---
p = pathlib.Path('api/src/routes/finance.js')
t = p.read_text()
t = t.replace("paidVia: b.paid_via === 'mpesa' ? 'mpesa' : 'cash',",
              "paidVia: b.paid_via === 'pix' ? 'pix' : b.paid_via === 'card' ? 'card' : 'cash',")
p.write_text(t)

# --- routes/payments.js ---
p = pathlib.Path('api/src/routes/payments.js')
t = p.read_text()
t = t.replace("if (!['cash', 'mpesa_stk', 'mpesa_manual'].includes(method)) bad('Invalid payment method');",
              "if (!['cash', 'pix', 'pix_manual', 'card'].includes(method)) bad('Método de pagamento inválido');")
t = t.replace("if (method === 'mpesa_stk') bad('M-Pesa STK push is coming soon. Use a manual M-Pesa code or cash.');",
              "if (method === 'pix') bad('Pagamento Pix automático está em breve. Use um código Pix manual ou dinheiro.');")
t = t.replace("body.mpesa_ref = cleanStr(body.mpesa_ref, 40, 'M-Pesa code');",
              "body.pix_ref = cleanStr(body.pix_ref, 40, 'Código Pix');")
t = t.replace("if (method === 'mpesa_manual' && !body.mpesa_ref) bad('M-Pesa transaction code is required');",
              "if (method === 'pix_manual' && !body.pix_ref) bad('Código da transação Pix é obrigatório');")
t = t.replace("const completesNow = method !== 'mpesa_stk';",
              "const completesNow = method !== 'pix';")
t = t.replace("mpesaRef: body.mpesa_ref || null,",
              "pixRef: body.pix_ref || null,")
t = t.replace("async function settleStkPayment(db, env, payment, { success, mpesaRef }) {",
              "async function settlePixPayment(db, env, payment, { success, pixRef }) {")
t = t.replace("mpesaRef: mpesaRef || payment.mpesaRef,",
              "pixRef: pixRef || payment.pixRef,")
p.write_text(t)

# --- index.js: callback route name ---
p = pathlib.Path('api/src/index.js')
t = p.read_text()
t = t.replace('mpesaCallbackRoute', 'pixCallbackRoute')
t = t.replace('M-Pesa', 'Pix')
p.write_text(t)

# --- platform.js: mensagens ---
p = pathlib.Path('api/src/routes/platform.js')
t = p.read_text()
t = t.replace('M-Pesa', 'Pix')
t = t.replace('bank transfer', 'transferência bancária')
p.write_text(t)

print('backend migrado para Pix')
