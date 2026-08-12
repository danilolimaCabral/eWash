import pathlib

f = pathlib.Path('api/src/notify.js')
t = f.read_text()

t = t.replace(
    "    '{business}: Hello {customer}, order {order_code} assessed: {items}. Total {total}. Pay by M-Pesa or cash when you pick up. Karibu!',",
    "    '{business}: Olá {customer}, pedido {order_code} avaliado: {items}. Total {total}. Pague via Pix ou em dinheiro ao retirar. Obrigado!',"
)
t = t.replace(
    "    '{business}: Payment of {amount} received for order {order_code}. Balance: {balance}. Asante!',",
    "    '{business}: Pagamento de {amount} recebido para o pedido {order_code}. Saldo: {balance}. Obrigado!',"
)
t = t.replace(
    "    '{business}: Hello {customer}, your order {order_code} is ready for pickup. {balance_note}Karibu!',",
    "    '{business}: Olá {customer}, seu pedido {order_code} está pronto para retirada. {balance_note}Obrigado!',"
)
t = t.replace(
    "    '{business}: Order {order_code} delivered/collected. Thank you for choosing us, {customer}!',",
    "    '{business}: Pedido {order_code} entregue/retirado. Obrigado por nos escolher, {customer}!',"
)
t = t.replace(
    "    '{business}: Friendly reminder — order {order_code} is ready and has a balance of {balance}. Pay via M-Pesa to collect. Asante!',",
    "    '{business}: Lembrete — o pedido {order_code} está pronto e possui saldo de {balance}. Pague via Pix para retirar. Obrigado!',"
)
t = t.replace(
"""// Normalize any Kenyan phone input to 254XXXXXXXXX (no + sign):
//   0724814117 → 254724814117 · 724724814117 → 254724814117 ·
//   +254724… → 254724… · 01124814117 → 2541124814117
export function normalizeKenyaPhone(phone) {
  let digits = String(phone || '').replace(/\\D/g, '');
  if (digits.startsWith('254')) return digits;
  digits = digits.replace(/^0+/, '');
  return `254${digits}`;
}""",
"""// Normalize any Brazilian phone input to 55XXXXXXXXXXX (no + sign):
//   (11) 90000-0000 → 5511900000000 · 11900000000 → 5511900000000 ·
//   +5511… → 5511… · 011 9… → 5511…
export function normalizeKenyaPhone(phone) {
  let digits = String(phone || '').replace(/\\D/g, '');
  if (digits.startsWith('55')) return digits;
  digits = digits.replace(/^0+/, '');
  return `55${digits}`;
}"""
)

f.write_text(t)
print('notify.js atualizado')

# Remover menções mpesa restantes das mensagens do frontend (NewOrderView/FinanceView template de texto)
for p in ['web/src/views/NewOrderView.vue', 'web/src/views/FinanceView.vue', 'web/src/views/ReportsView.vue', 'web/src/views/PlatformRevenueView.vue']:
    pf = pathlib.Path(p)
    t2 = pf.read_text().replace('Pay by M-Pesa or cash when you pick up. Karibu!', 'Pague via Pix ou em dinheiro ao retirar. Obrigado!')
    t2 = t2.replace('Assess order', 'Avaliar pedido').replace('Assessed', 'Avaliado')
    if t2 != pf.read_text():
        pf.write_text(t2)
        print(p, 'atualizado')
