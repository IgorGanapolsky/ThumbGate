# ThumbGate Sitemap & Redirect Leak Scan Report

**Date:** 2026-06-10
**Objective:** Scan the pilot French e-commerce websites for sitemap discoverability, redirect loops, SSL consistency, and Stripe/checkout leaks.

## Executive Summary

- **Total Sites Scanned:** 5
- **Sites with Anomalies/Leaks:** 1
- **Total Anomalies Detected:** 1

### Quick Dashboard

| Domain | Page Fetch | Sitemap | Stripe Found | Redirect Issues | Leaks/Anomalies | Status |
| --- | --- | --- | --- | --- | --- | --- |
| luzaka.com | ✅ OK | ❌ Missing | No | ✅ Clean | 1 | 🔴 Needs Patch |
| parissima.com | ✅ OK | ✅ Found (1) | No | ✅ Clean | 0 | 🟢 Healthy |
| boutique-artisans-du-monde.com | ✅ OK | ✅ Found (10) | No | ✅ Clean | 0 | 🟢 Healthy |
| eclatparis.com | ✅ OK | ✅ Found (9) | No | ✅ Clean | 0 | 🟢 Healthy |
| aliexfantaisies.com | ✅ OK | ✅ Found (10) | No | ✅ Clean | 0 | 🟢 Healthy |

---

## Detailed Findings by Site

### 1. luzaka.com

- **Target URL:** https://www.luzaka.com
- **Page Load:** Successful
- **Sitemap:** Not found in default paths or robots.txt
- **Stripe Integration:** Not detected on homepage

#### Redirect Chains

- **HTTP to HTTPS redirect:** `http://luzaka.com` status `200`
  - Chain: `http://luzaka.com` (301) ➔ `https://luzaka.com/` (301) ➔ `https://www.luzaka.com/` (200)
- **Non-WWW to WWW redirect:** `https://luzaka.com` status `200`
  - Chain: `https://luzaka.com` (301) ➔ `https://www.luzaka.com/` (200)

#### Detected Anomalies & Leaks

- **[LEAK]** Missing sitemap: no sitemap.xml found in robots.txt or standard paths

### 1. parissima.com

- **Target URL:** https://www.parissima.com
- **Page Load:** Successful
- **Sitemap:** Found at `https://www.parissima.com/1_index_sitemap.xml` with 1 URLs
- **Stripe Integration:** Not detected on homepage

#### Redirect Chains

- **HTTP to HTTPS redirect:** `http://parissima.com` status `200`
  - Chain: `http://parissima.com` (301) ➔ `https://www.parissima.com/fr/` (200)
- **Non-WWW to WWW redirect:** `https://parissima.com` status `200`
  - Chain: `https://parissima.com` (301) ➔ `https://www.parissima.com/fr/` (200)

#### Sitemap URL Verification (Sample Checks)

  - `https://www.parissima.com/1_fr_0_sitemap.xml` ➔ Direct resolve (Status: 200)

#### Detected Anomalies & Leaks

*No leaks or redirect anomalies detected.*

### 1. boutique-artisans-du-monde.com

- **Target URL:** https://boutique-artisans-du-monde.com
- **Page Load:** Successful
- **Sitemap:** Found at `https://boutique-artisans-du-monde.com/sitemap.xml` with 10 URLs
- **Stripe Integration:** Not detected on homepage

#### Redirect Chains

- **HTTP to HTTPS redirect:** `http://boutique-artisans-du-monde.com` status `200`
  - Chain: `http://boutique-artisans-du-monde.com` (301) ➔ `https://boutique-artisans-du-monde.com/` (200)
- **Non-WWW to WWW redirect:** `https://boutique-artisans-du-monde.com` status `200`
  - Chain: `https://boutique-artisans-du-monde.com` (200)

#### Sitemap URL Verification (Sample Checks)

  - `https://boutique-artisans-du-monde.com/post-sitemap.xml` ➔ Direct resolve (Status: 200)
  - `https://boutique-artisans-du-monde.com/page-sitemap.xml` ➔ Direct resolve (Status: 200)
  - `https://boutique-artisans-du-monde.com/product-sitemap.xml` ➔ Direct resolve (Status: 200)

#### Detected Anomalies & Leaks

*No leaks or redirect anomalies detected.*

### 1. eclatparis.com

- **Target URL:** https://eclatparis.com
- **Page Load:** Successful
- **Sitemap:** Found at `https://eclatparis.com/sitemap.xml` with 9 URLs
- **Stripe Integration:** Not detected on homepage

#### Redirect Chains

- **HTTP to HTTPS redirect:** `http://eclatparis.com` status `200`
  - Chain: `http://eclatparis.com` (301) ➔ `https://eclatparis.com/` (200)
- **Non-WWW to WWW redirect:** `https://eclatparis.com` status `200`
  - Chain: `https://eclatparis.com` (200)

#### Sitemap URL Verification (Sample Checks)

  - `https://eclatparis.com/sitemap_agentic_discovery.xml` ➔ Direct resolve (Status: 200)
  - `https://eclatparis.com/sitemap_products_1.xml?from=8490284613918&amp;to=15949066994046` ➔ Direct resolve (Status: 200)
  - `https://eclatparis.com/sitemap_pages_1.xml?from=121197003038&amp;to=688311075198` ➔ Direct resolve (Status: 200)

#### Detected Anomalies & Leaks

*No leaks or redirect anomalies detected.*

### 1. aliexfantaisies.com

- **Target URL:** https://aliexfantaisies.com
- **Page Load:** Successful
- **Sitemap:** Found at `https://aliexfantaisies.com/sitemap.xml` with 10 URLs
- **Stripe Integration:** Not detected on homepage

#### Redirect Chains

- **HTTP to HTTPS redirect:** `http://aliexfantaisies.com` status `200`
  - Chain: `http://aliexfantaisies.com` (302) ➔ `https://aliexfantaisies.com/` (200)
- **Non-WWW to WWW redirect:** `https://aliexfantaisies.com` status `200`
  - Chain: `https://aliexfantaisies.com` (200)

#### Sitemap URL Verification (Sample Checks)

  - `https://aliexfantaisies.com/` ➔ Direct resolve (Status: 200)
  - `https://aliexfantaisies.com/amp-aliexfantaisies.php` ➔ Redirected to `https://aliexfantaisies.com` (Status: 200)
  - `https://aliexfantaisies.com/apropos.php` ➔ Direct resolve (Status: 200)

#### Detected Anomalies & Leaks

*No leaks or redirect anomalies detected.*


