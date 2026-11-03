# ThumbGate-Core: Google Cloud & Vertex AI Enterprise Deployment Architecture

> **Secure, Isolated, and High-Performance Enterprise SaaS Architecture for ThumbGate-Core.**  
> Deployed on Google Cloud Platform (GCP) with Vertex AI, Cloud Run, and Secure VPC Service Controls.

---

## 1. System Architecture Overview

ThumbGate-Core enterprise deployments use a zero-trust, multi-region Cloud Run architecture backed by managed Google Cloud services and Vertex AI private endpoints.

```
+---------------------------------------------------------------------------------+
|                                 CLIENT LAYER                                    |
|   [ ThumbGate CLI ]       [ Cursor / Claude Code / Codex ]    [ Dashboard ]     |
+---------------------------------------------------------------------------------+
                                         │
                                         ▼
+---------------------------------------------------------------------------------+
|                       GCP CLOUD RUN & API GATEWAY                               |
|        [ Global HTTP(S) Load Balancer & Cloud Armor WAF ]                       |
|        [ Cloud Run: ThumbGate Core SaaS API (Node.js / Express) ]               |
+---------------------------------------------------------------------------------+
                                         │
                                         ▼
+---------------------------------------------------------------------------------+
|                           SECURE ENTERPRISE VPC                                 |
|   [ OAuth 2.1 PKCE ]     [ Switchyard & DFlash ]     [ Vertex AI Endpoint ]     |
|   [ Cloud SQL PostgreSQL (Encrypted Tenant Store) ]                             |
+---------------------------------------------------------------------------------+
```

---

## 2. Infrastructure Deployment Pipeline (`deploy/gcp/`)

### Step 1: Container Build & Artifact Registry Push
```bash
gcloud builds submit --tag gcr.io/thumbgate-prod/thumbgate-control-plane:latest .
```

### Step 2: Cloud Run Sovereign Service Deployment
```bash
gcloud run deploy thumbgate-control-plane \
  --image gcr.io/thumbgate-prod/thumbgate-control-plane:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 2Gi \
  --cpu 2 \
  --min-instances 1 \
  --max-instances 20 \
  --set-env-vars "NODE_ENV=production,THUMBGATE_CLOUD_SaaS=true" \
  --set-cloudsql-instances thumbgate-prod:us-central1:thumbgate-db
```

### Step 3: Cloud SQL PostgreSQL Provisioning
```bash
gcloud sql instances create thumbgate-db \
  --database-version=POSTGRES_15 \
  --tier=db-custom-2-8192 \
  --region=us-central1 \
  --root-password="${DB_ROOT_PASSWORD}"
```

---

## 3. Deployment Stages & Verification Gates

| Stage | Action | Verification Command | Success Criteria |
|---|---|---|---|
| **1. Preflight Audit** | Run local integrity checks | `node --test tests/api-server.test.js` | 100% test pass rate |
| **2. Container Build** | Build multi-arch OCI image | `docker build -t thumbgate-core .` | Zero build errors |
| **3. Staging Canary** | Deploy to Cloud Run staging | `gcloud run services describe staging-plane` | Status ready & healthy |
| **4. Production Promotion** | Traffic split 100% to production | `gcloud run services update-traffic` | Latency < 50ms, 0 errors |
| **5. Live Verification** | Endpoint health probe | `curl -s https://thumbgate.ai/health` | `{"status":"HEALTHY"}` |

---

## 4. Operational Runbooks & Rollback Strategy

* **Automatic Rollback**: If Cloud Run health checks fail for 3 consecutive 10s intervals, traffic automatically reverts to the previous stable revision:
  ```bash
  gcloud run services update-traffic thumbgate-control-plane --to-revisions LATEST=0,PREVIOUS=100
  ```
* **Metrics & Monitoring**: Real-time telemetry streams directly into the local Dayglass SQLite database (`~/.dayglass/dayglass.sqlite`) and Cloud Monitoring dashboards.
