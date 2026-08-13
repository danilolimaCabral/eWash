# LavTr — build single-stage otimizado p/ Railway (build com 1GB RAM)
# web/dist já está commitado no repo, eliminando o estágio de build do frontend
FROM node:22-alpine
WORKDIR /app
ENV PNPM_HOME=/root/.local/share/pnpm
RUN corepack enable
# Copiar package.json e lockfile SE DISPONÍVEL (lockfile não é obrigatório)
COPY api/package.json ./
RUN if [ -f api/pnpm-lock.yaml ]; then cp api/pnpm-lock.yaml ./; fi
RUN pnpm install --prod 2>&1 | tail -5
# Código e assets pré-compilados
COPY api/src ./src
COPY api/migrations ./migrations
COPY web/dist ./web/dist
# Diretorio do banco SQLite (DATABASE_URL=file:/app/db/lavtr.db)
RUN mkdir -p /app/db
ENV NODE_ENV=production
ENV PORT=8080
CMD ["node", "src/server.js"]
