# LavTr — imagem única: API Express + SPA Vue
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS web
WORKDIR /app/web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web ./
RUN pnpm build

FROM base AS api
WORKDIR /app
COPY api/package.json ./
RUN pnpm install --prod=false
COPY api ./
COPY --from=web /app/web/dist /app/web/dist
ENV NODE_ENV=production
ENV PORT=8080
CMD ["node", "src/server.js"]
