---
name: run-local
description: Start the local development stack (API + frontend)
disable-model-invocation: true
---

# Run Local Dev Stack

Start the Magic Bracket Simulator local development environment.

## Steps

1. **Start API + Frontend** by running `npm run dev` from the repo root. This launches:
   - API (Next.js) on http://localhost:3000
   - Frontend (Vite) on http://localhost:5173

2. Simulations run on the desktop worker (`worker_flutter/`, `flutter run -d macos`), which needs a Mac or Windows machine with Flutter; it talks to the hosted API.

## Notes

- API + frontend run via concurrently; both are visible in the same terminal output.
- Frontend expects API at localhost:3000 (configured in `frontend/public/config.json`).
