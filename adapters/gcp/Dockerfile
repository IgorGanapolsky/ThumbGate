# ThumbGate Enterprise — Dialogflow CX webhook gate (Cloud Run / Cloud Functions)
# Build:  gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT/REPO/thumbgate-dfcx-gate
# Deploy: gcloud run deploy thumbgate-dfcx-gate \
#           --image REGION-docker.pkg.dev/PROJECT/REPO/thumbgate-dfcx-gate \
#           --region REGION --no-allow-unauthenticated \
#           --set-env-vars THUMBGATE_DFCX_FULFILLMENT_URL=https://your-existing-fulfillment
#
# Runs entirely in the customer's GCP tenant. No conversational data leaves the VPC.

FROM node:20-slim

WORKDIR /app

# Install only production deps for a slim runtime image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --onnxruntime-node-install-cuda=skip || npm ci --omit=dev --ignore-scripts

# App code (scripts/ holds the gate engine; adapters/gcp holds the DFCX middleware).
COPY scripts ./scripts
COPY adapters ./adapters
COPY config ./config

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Cloud Run sets $PORT; the server listens on it.
CMD ["node", "adapters/gcp/server.js"]
