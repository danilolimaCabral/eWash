# LavTr — Guia de Deploy (SaaS de Lavanderia Multi-tenant)

Adaptação brasileira do eWash (MIT) para revenda a lavanderias no Brasil.

## Visão geral da arquitetura

O sistema usa **Cloudflare Workers** (API + SPA) com **D1** (SQLite serverless) como banco.
Toda a infraestrutura cabe no plano **gratuito** da Cloudflare:

| Recurso | Função | Custo |
|---|---|---|
| Cloudflare Worker | API + interface Vue | Grátis |
| D1 Database | Dados de todos os tenants | Grátis |
| workers.dev (ou domínio próprio) | URL pública | Grátis / domínio pago |
| Cron trigger diário | Lembretes e despesas recorrentes | Grátis |

## Multi-tenancy (como funciona)

Cada lavandaria é um **tenant** isolado no mesmo banco, com:
- Catálogo de serviços, clientes, pedidos e financeiro próprios
- Papéis com permissões granulares: Dono/Admin, Atendente, Operador, Entregador
- Prefixo de código próprio (ex: `LV-0001`)
- Assinatura de plano paga a você (plataforma): Starter R$99, Pro R$199, Premium R$349
- Trial de 14 dias e faturamento recorrente com faturas/invoice

Você (dono da plataforma) controla: criação de tenants, cobrança, métricas de receita,
audit log completo e bloqueio/ativação de lavanderias.

## Como fazer deploy (1 comando)

```bash
cd /home/ubuntu/eWash/api
bunx wrangler login            # uma única vez (abre navegador, token guardado)
bun run deploy                 # cria DB, aplica migrations, publica worker, gera secrets
```

O script é idempotente: pode rodar de novo a qualquer momento sem risco.

## Configurar depois do deploy

1. **Admin da plataforma** — defina no Cloudflare (dashboard > Workers > lavtr > Settings > Variables):
   - `PLATFORM_ADMIN_EMAIL` (seu e-mail)
   - `PLATFORM_ADMIN_PASSWORD` (senha forte)
   - `PLATFORM_ADMIN_NAME` (ex: Danilo Cabral)
   - Acesse `https://lavtr.<subdomínio>.workers.dev/platform/login`
2. **Domínio próprio** (opcional): `bunx wrangler pages` ou dashboard > Custom domains.
   Atualize `APP_URL` no wrangler.toml e rode `bun run deploy` de novo.
3. **E-mail transacional** (ativação de contas, reset de senha):
   - `wrangler secret put SMTP_USERNAME` / `wrangler secret put SMTP_PASSWORD` (Gmail App Password ou Resend)
4. **Pix automático** (fase 2 — opcional): integrar Mercado Pago / PagBank no endpoint
   `POST /api/orders/:id/payments`. Hoje funciona registro manual com código Pix.

## Testes validados (local)

- Registro de nova lavandaria com ativação por e-mail
- Catálogo brasileiro completo (Lavagem R$8/kg, Passadoria R$6/kg, Edredom, Terno à seco etc.)
- Pedido com cálculo por quilo, pagamento Pix manual, dashboard financeiro

## Comandos úteis

```bash
bun run dev          # servidor local em http://localhost:8787
bun run build        # compila SPA
bun run deploy       # deploy produção
bun run db:migrate:remote   # aplicar migrations pendentes
```

## Vender para lavanderias

1. Cada lavandaria se cadastra em `/register` (self-service, trial 14 dias) — ou você cria
   manualmente pelo painel da plataforma (`/platform/tenants`).
2. Sugestão de preço: R$ 99–349/mês conforme plano; cobrança inicial manual via Pix e
   depois automatizar com gateway.
3. Landing page de vendas pode ser criada como página estática (sugestão: `/site` no mesmo
   worker ou Cloudflare Pages separado).
