FROM postgres:16-alpine AS db
COPY --chmod=755 infra/init-role.sh /docker-entrypoint-initdb.d/01-init-role.sh

FROM caddy:2-alpine AS caddy
COPY infra/Caddyfile /etc/caddy/Caddyfile

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS tools
COPY package.json package-lock.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci --no-audit --no-fund && ./node_modules/.bin/prisma generate
COPY prisma ./prisma
COPY src/lib ./src/lib
COPY tsconfig.json ./
USER node
CMD ["npm", "run", "db:migrate"]

FROM tools AS builder
USER root
COPY . .
RUN npm run build

FROM base AS app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
