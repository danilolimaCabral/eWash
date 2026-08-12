import pathlib

# --- schema.js: billing_payments method enum ---
p = pathlib.Path('api/src/db/schema.js')
t = p.read_text()
t = t.replace("method: text('method', { enum: ['cash', 'bank', 'mpesa_manual'] }).notNull(),",
              "method: text('method', { enum: ['cash', 'bank', 'pix_manual'] }).notNull(),")
p.write_text(t)

# --- routes/payments.js: callback route + STK comments ---
p = pathlib.Path('api/src/routes/payments.js')
t = p.read_text()
t = t.replace("export const mpesaCallbackRoute = new Hono();",
              "export const pixCallbackRoute = new Hono();")
t = t.replace("mpesaCallbackRoute.post('/payments/mpesa/callback/:token'",
              "pixCallbackRoute.post('/payments/pix/callback/:token'")
t = t.replace("// Record a payment. Cash and manual M-Pesa codes complete immediately;",
              "// Record a payment. Cash and manual Pix codes complete immediately;")
t = t.replace("// /api/payments/mpesa/callback/<MPESA_CALLBACK_SECRET>.",
              "// /api/payments/pix/callback/<PIX_CALLBACK_SECRET>.")
t = t.replace("mpesaRef: body.mpesa_ref || body.MpesaReceiptNumber,",
              "pixRef: body.pix_ref || body.pixE2EId,")
t = t.replace("// Sandbox: simulate the customer entering their M-Pesa PIN. Authenticated,",
              "// Sandbox: simulate the customer approving the Pix payment. Authenticated,")
t = t.replace("if (payment.method !== 'mpesa_stk') bad('Only STK payments can be simulated');",
              "if (payment.method !== 'pix') bad('Only Pix payments can be simulated');")
p.write_text(t)

# --- orders.js: remaining error message ---
p = pathlib.Path('api/src/routes/orders.js')
t = p.read_text()
t = t.replace("bad('M-Pesa code is required');", "bad('Código Pix é obrigatório');")
p.write_text(t)

# --- policies.js ---
p = pathlib.Path('api/src/policies.js')
t = p.read_text()
t = t.replace("'Take payments (cash / M-Pesa)'", "'Receber pagamentos (dinheiro / Pix)'")
p.write_text(t)

# --- PlatformBillingView.vue ---
p = pathlib.Path('web/src/views/PlatformBillingView.vue')
t = p.read_text()
t = t.replace("<option value=\"pix_manual\">M-Pesa code (manual)</option><option value=\"bank\">Bank transfer</option>",
              "<option value=\"pix_manual\">Código Pix (manual)</option><option value=\"bank\">Transferência bancária</option>")
p.write_text(t)

print('segunda passada concluída')
