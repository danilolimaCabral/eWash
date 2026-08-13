# LavTr — build single-stage otimizado p/ Railway (build com 1GB RAM)
# web/dist já está commitado no repo, eliminando o estágio de build do frontend
FROM node:22-alpine
WORKDIR /app

# Instalar apenas dependências de produção da API (8 pacotes: express, hono, drizzle, libsql, mysql2, nodemailer)
COPY api/package.json api/pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    pnpm install --prod

# Código e assets pré-compilados
COPY api/src ./src
COPY api/migrations ./migrations
COPY web/dist ./web/dist

ENV NODE_ENV=production
ENV PORT=8080
CMD ["node", "src/server.js"]
