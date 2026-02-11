# Forge Engine

Headless MTG Forge simulator assets. These are copied into the worker Docker image at build time.

- `run_sim.sh` — Entrypoint script that runs Forge in simulation mode under xvfb
- `precons/` — Preconstructed Commander decks (.dck files) and manifest.json
- `decks/` — Input volume for custom decks (mounted at runtime)
- `scripts/` — Utility scripts (e.g., generate_manifest.py)
- `test/` — Test fixtures for simulation validation

Forge itself (Java JRE + forge.sh) is downloaded at Docker build time from GitHub releases.
