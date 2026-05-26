# Skill: Configure Analytics

Repeatable skill for setting up Plausible, PostHog, and GA4 analytics keys
in both local `.env` and Railway production environment variables.

## When to use

- New session notices analytics env vars are missing
- After rotating any analytics API key
- After creating a new GA4 property

## Prerequisites

- Chrome logged into: plausible.io, us.posthog.com, analytics.google.com
- Railway MCP authenticated OR Chrome logged into railway.com

## Steps

### 1. Gather keys from dashboards

**Plausible API key:**
- Navigate to https://plausible.io/settings/api-keys
- If no key exists, create one named "thumbgate-railway-prod"
- Copy the key value

**PostHog project API key:**
- Navigate to https://us.posthog.com/settings/project#variables
- Copy the "Project API Key" (starts with `phc_`)

**GA4 Measurement ID:**
- Navigate to https://analytics.google.com
- Select the ThumbGate property (or create one: Admin → Create Property)
- Go to Data Streams → Web stream → copy Measurement ID (format: G-XXXXXXXXXX)
- If no ThumbGate property exists, skip — Plausible is primary

### 2. Set local .env

Write/update `repo/.env` with:
```
PLAUSIBLE_API_KEY=<key>
PLAUSIBLE_SITE_ID=thumbgate-production.up.railway.app
POSTHOG_API_KEY=<phc_key>
THUMBGATE_GA_MEASUREMENT_ID=<G-ID or leave commented>
```

### 3. Set Railway production vars

**Option A — Railway MCP (preferred):**
```
mcp__railway__set_variables({
  project_id: "<thumbgate-project-id>",
  service_id: "<thumbgate-service-id>",
  variables: {
    PLAUSIBLE_API_KEY: "<key>",
    POSTHOG_API_KEY: "<phc_key>",
    THUMBGATE_GA_MEASUREMENT_ID: "<G-ID>"
  }
})
```

**Option B — Chrome (if MCP not authenticated):**
- Navigate to railway.com dashboard
- Click into the ThumbGate project → production service
- Go to Variables tab
- Add/update each key-value pair
- Railway auto-redeploys on variable change

### 4. Verify

```bash
# Local: run funnel report
npm run social:funnel

# Production: check template var injection
curl -s https://thumbgate-production.up.railway.app/checkout/pro | grep -o 'phc_[a-zA-Z0-9]*'
curl -s https://thumbgate-production.up.railway.app/checkout/pro | grep -o 'G-[A-Z0-9]*'
```

## Current values (last updated 2026-05-26)

- Plausible site: `thumbgate-production.up.railway.app`
- PostHog project: US Cloud, project ID 299775
- GA4: No ThumbGate property exists (only "Easy Smart Home LLC" in account)
