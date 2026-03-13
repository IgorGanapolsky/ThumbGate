# syntax=docker/dockerfile:1

# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first to leverage layer cache
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --no-audit --no-fund

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Non-root user for security
RUN addgroup -S rlhf && adduser -S rlhf -G rlhf

WORKDIR /app

# Copy production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY package*.json ./
COPY scripts/ ./scripts/
COPY src/ ./src/
COPY config/ ./config/
COPY adapters/ ./adapters/
COPY public/ ./public/

# Data directory for runtime feedback logs
RUN mkdir -p /data && chown rlhf:rlhf /data

USER rlhf

# Railway / Cloud Run sets PORT dynamically; default to 8787
ENV PORT=8787
ENV NODE_ENV=production

EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

CMD ["node", "src/api/server.js"]
