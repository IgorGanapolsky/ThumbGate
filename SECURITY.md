# Security Policy

## Supported Versions

This project currently supports the latest `main` branch.

## Reporting a Vulnerability

Please open a private security report via GitHub Security Advisories.
If that is unavailable, open an issue with minimal reproduction details and no secrets.

## Security Controls

- API auth required by default (`Authorization: Bearer <key>`).
- Safe-path enforcement for file inputs/outputs (restricted to feedback data root by default).
- Schema validation boundaries before memory promotion.
- No plaintext secret files committed (`.env*` ignored).

## Hardening Recommendations

- Set `THUMBGATE_API_KEY` in all non-local deployments.
- Keep `THUMBGATE_ALLOW_EXTERNAL_PATHS` disabled.
- Rotate keys regularly.
- Record every production secret rotation in its matching `*_ROTATED_AT` variable.
- Keep `THUMBGATE_PUBLIC_APP_ORIGIN` and `THUMBGATE_BILLING_API_BASE_URL` aligned with the canonical hosted flow before deploying.
- Run `npm run deploy:policy -- --profiles=runtime,billing,deploy` before any production deploy.
