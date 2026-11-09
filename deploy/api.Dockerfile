# API + worker do Voll Plan (Fastify). Contexto de build: raiz do monorepo.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/voice-gateway/package.json apps/voice-gateway/
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @voll/api

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app/apps/api
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY apps/api/migrations ./migrations
COPY apps/api/package.json ./
USER node
EXPOSE 3333
CMD ["node", "dist/server.js"]
