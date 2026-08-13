# ThumbGate — Partner Cost Sheet

**For:** Shreyans Bhansali / Assistiv AI / MakersClaw platform listing  
**Date:** 2026-08-13  
**Currency:** USD

## Billable units

| Unit | Rate | Trigger |
|------|------|---------|
| Policy evaluation (`eval`) | **$0.001** | Each allow / warn / block decision |
| Human escalation | **$0.010** | Escalation created |
| Rule promotion | **$0.005** | Failure → durable prevention rule |
| Execution receipt | **$0.001** | Idempotent audit receipt written |

Enterprise eval overage after included volume: **$0.0008**

## Tiers (monthly minimum = floor; included volume is creditable)

| Tier | Minimum | Included evals | Overage |
|------|---------|----------------|---------|
| Starter | **$99** | 100,000 | $0.001 |
| Team | **$499** | 500,000 | $0.001 |
| Enterprise | **$2,499** | 3,000,000 | $0.0008 |

## Worked examples (Team $499)

| Monthly evals | Raw usage | Billed |
|---------------|-----------|--------|
| 50,000 | $50 | **$499** (floor) |
| 400,000 | $400 | **$499** (floor) |
| 700,000 | $700 | **$700** |

## Direct retail (not the platform tier)

- Pro self-serve: **$19/mo** or **$149/yr**
- Sprint diagnostic: **$499** one-time

## API status (one line)

**Core evaluate / feedback / escalations / receipts APIs are LIVE** at `https://thumbgate.ai` with public OpenAPI.

Partner overage invoicing is **soft-launch**: minimums sell now; overage is waived until rating productizes (~2 weeks).

## Settlement

Platform share: **open — match your standard.**

First clients: manual API key provision by ThumbGate.
