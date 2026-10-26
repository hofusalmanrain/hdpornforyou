# Multi-stage build: Vite frontend + Node/Express server. PostgreSQL runs in
# a sibling service (see docker-compose.yml) — no DB binaries in this image.

############ Stage 1: build frontend ############
FROM oven/bun:1.3 AS frontend
WORKDIR /app
COPY package.json bun.lock* bunfig.toml* ./
RUN bun install --frozen-lockfile || bun install
COPY . .
RUN bun run build

############ Stage 2: install server deps ############
FROM node:20-bookworm-slim AS server-deps
WORKDIR /srv
COPY server/package.json server/package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund

############ Stage 3: runtime ############
FROM node:20-bookworm-slim AS runtime
RUN apt-get update -qq && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
RUN groupadd -r hdpornforyou && useradd -r -g hdpornforyou -m hdpornforyou
WORKDIR /srv
ENV NODE_ENV=production \
    PORT=3001 \
    STATIC_DIR=/srv/public

COPY server/src ./src
COPY server/package.json ./package.json
COPY --from=server-deps /srv/node_modules ./node_modules
COPY --from=frontend /app/dist ./public
RUN mkdir -p /srv/uploads/favicon && chown -R hdpornforyou:hdpornforyou /srv

USER hdpornforyou
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
