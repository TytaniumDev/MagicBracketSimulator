# Frontend (Web UI)

The **only** web UI for the Magic Bracket Simulator. This package contains all user-facing pages and components. It talks to the API service over HTTP only; there is no business logic here.

## Prerequisites

- Node.js 18+
- API service running (see [api/README.md](../api/README.md))

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` (or copy from `.env.example`):

```env
VITE_API_URL="http://localhost:3000"
```

Use the URL where the API is running. Default is `http://localhost:3000`. (`VITE_ORCHESTRATOR_URL` remains supported for backward compatibility.)

## Running

### Development

```bash
npm run dev
```

The app will be at http://localhost:5173. Ensure the API is running on the port set in `VITE_API_URL` so API calls succeed.

### Build

```bash
npm run build
npm run preview
```

## Stack

- Vite + React + TypeScript
- Tailwind CSS v4
- React Router

All API calls use `VITE_API_URL` (e.g. `/api/precons`, `/api/jobs`, `/api/jobs/:id`). (`VITE_ORCHESTRATOR_URL` is still recognized for legacy setups.)
