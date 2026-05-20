# syntax=docker/dockerfile:1

# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Native build deps for better-sqlite3 et al. — Alpine uses musl libc and most
# native-module prebuilt binaries ship glibc-only, so node-gyp falls back to
# compiling from source and needs Python + a C++ toolchain.
RUN apk add --no-cache python3 make g++

# Copy manifests first to leverage layer cache
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --no-audit --no-fund

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

RUN apk add --no-cache git

# Non-root user for security
RUN addgroup -S thumbgate && adduser -S thumbgate -G thumbgate

WORKDIR /app

# Copy production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY package*.json ./
COPY scripts/ ./scripts/
COPY assets/ ./assets/
COPY src/ ./src/
COPY config/ ./config/
COPY adapters/ ./adapters/
COPY public/ ./public/
COPY .well-known/ ./.well-known/

# Data directory for runtime feedback logs
RUN mkdir -p /data && chown thumbgate:thumbgate /data

USER thumbgate

# Railway / Cloud Run sets PORT dynamically; default to 8787
ENV PORT=8787
ENV NODE_ENV=production

EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

CMD ["node", "src/api/server.js"]
