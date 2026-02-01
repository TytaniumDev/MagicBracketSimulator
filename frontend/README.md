# Frontend (Web UI)

The **only** web UI for the Magic Bracket Simulator. This package contains all user-facing pages and components. It talks to the orchestrator service over HTTP only; there is no business logic here.

## Prerequisites

- Node.js 18+
- Orchestrator service running (see [orchestrator-service/README.md](../orchestrator-service/README.md))

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` (or copy from `.env.example`):

```env
VITE_ORCHESTRATOR_URL="http://localhost:3000"
```

Use the URL where the orchestrator API is running. Default is `http://localhost:3000`.

## Running

### Development

```bash
npm run dev
```

The app will be at http://localhost:5173. Ensure the orchestrator is running on the port set in `VITE_ORCHESTRATOR_URL` so API calls succeed.

### Build

```bash
npm run build
npm run preview
```

## Stack

- Vite + React + TypeScript
- Tailwind CSS v4
- React Router

All API calls use `VITE_ORCHESTRATOR_URL` (e.g. `/api/precons`, `/api/jobs`, `/api/jobs/:id`).
