# Showcase Journal

## UX Friction Points

*   **Missing Contributing Guide:** [RESOLVED] Users looking to contribute have no clear entry point. `CONTRIBUTING.md` has been enhanced with project structure and testing details.
*   **Deployment Info Clutter:** Deployment instructions were mixed with local run instructions, making the "Quick Start" hard to find. These have been moved to `docs/DEPLOYMENT.md`.
*   **Misleading Quick Start:** The `npm run dev` command implied it started the full stack, but the worker required a separate process. This led to "PENDING" simulation states for new users.

## Fixes Applied

*   **Broken Links:** Replaced relative link for "Report Bug" with absolute GitHub URL to ensure it works from any context (e.g. forks, mirrors).
*   **Hero Image:** Generated and added a real screenshot (`docs/images/hero-screenshot.png`) to replace the placeholder, significantly improving "Curb Appeal".
*   **Root Clutter:** Moved `ARCHITECTURE.md`, `MODE_SETUP.md`, and `GCP_MIGRATION_FIX_PLAN.md` to `docs/` to keep the root clean and focused on the "Landing Page" experience.
*   **Golden Template Alignment:** Reordered `README.md` to strictly follow the "Golden Template" (Title -> Links -> Badges -> Hook -> Hero Visual).
*   **Internal Link Repair:** Updated `docs/DEPLOYMENT.md` and `CONTRIBUTING.md` to reflect the new file locations.
*   **Quick Start Reality Check:** Updated `README.md` to explicitly state that the Worker must be started in a separate terminal (requires Docker), preventing user confusion about why simulations aren't running.
*   **Header Polish:** Upgraded the `README.md` header to a centered HTML block for maximum "Curb Appeal", consolidating Title, Links, and Badges.
*   **Docs Organization:** Moved `API.md` to `docs/API.md` to further declutter the root directory and linked it in `README.md` and `CONTRIBUTING.md`.
