# Docs

Architecture and deployment documentation.

- `ARCHITECTURE.md` — System map: services, where data lives, a job end to end, delivery
- `../DATA_FLOW.md` — Step-by-step dispatch, reporting and aggregation (source of truth for that flow)
- `../API.md` — REST endpoints and payloads
- `MODE_SETUP.md` — Local vs GCP mode configuration
- `SECRETS_SETUP.md` — Where secrets live (Doppler → Secret Manager, GitHub Actions)
- `DEPLOYMENT.md` — Prerequisites and deployment steps
- `STALE_SWEEPER.md`, `SWEEPER_ALERTING.md` — The 15-minute stale-job sweeper and its alerts
- `PRECON_SYNC.md` — Archidekt precon sync
