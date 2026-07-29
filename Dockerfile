# syntax=docker/dockerfile:1

# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Debian/glibc base + Node 22 LTS — better-sqlite3 12.10.0 ships prebuilt
# glibc binaries for node ABI v127 (Node 22) / v137 (Node 23) / v141 (Node 24)
# / v147 (Node 25) via prebuild-install. Node 20 (ABI v115) has NO prebuild,
# which is why the previous Alpine+Node20 image had to compile from source
# with python3+make+g++. Moving to Node 22 lets prebuild-install resolve a
# ready binary and skip node-gyp entirely.

# Copy manifests first to leverage layer cache
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --no-audit --no-fund

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# git is invoked by some maintenance scripts; wget is used by the HEALTHCHECK
# and is NOT preinstalled on bookworm-slim, so install both here.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git wget poppler-utils tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Non-root user for security
RUN groupadd -r thumbgate && useradd -r -g thumbgate thumbgate

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
COPY openapi/ ./openapi/
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
