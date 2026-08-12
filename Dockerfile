# LavTr — imagem única: API Express + SPA Vue (build otimizado para 1GB RAM)
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package.json ./
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --frozen-lockfile
COPY web ./
RUN pnpm build

FROM node:22-alpine AS api
WORKDIR /app
COPY api/package.json api/pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    pnpm install --prod=false
COPY api/src ./src
COPY api/migrations ./migrations
COPY --from=web /app/web/dist /app/web/dist
ENV NODE_ENV=production
ENV PORT=8080
CMD ["node", "src/server.js"]
