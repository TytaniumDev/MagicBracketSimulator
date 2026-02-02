# Forge Simulation Engine

Headless, Dockerized MTG simulation service using [Card-Forge](https://github.com/Card-Forge/forge) in CLI sim mode. Runs Commander games with 4 decks and outputs detailed game logs for the [Analysis Service](../analysis-service/PRD.md).

## Forge Version

**Dynamic:** Defaults to the latest release from [Card-Forge/forge releases](https://github.com/Card-Forge/forge/releases). Fetched at build time via GitHub API.

To pin a specific version:

```bash
docker build --build-arg FORGE_VERSION=2.0.09 -t forge-sim .
```

Re-test on upgrades for sim CLI and log output compatibility.

## Quick Start

### Build

```bash
docker build -t forge-sim .
```

### Run (Orchestrator-style)

The orchestrator provides all 4 deck files in `/app/decks`. Use the `--decks` flag with 4 filenames:

```bash
# Create local dirs for mounts
mkdir -p ./decks ./logs

# Copy 4 decks into decks/
cp deck_0.dck deck_1.dck deck_2.dck deck_3.dck ./decks/

# Run simulation
docker run --rm \
  -v "$(pwd)/decks:/app/decks" \
  -v "$(pwd)/logs:/app/logs" \
  forge-sim \
  --decks deck_0.dck deck_1.dck deck_2.dck deck_3.dck \
  --simulations 2 \
  --id job_test1
```

**Note (Git Bash on Windows):** Use `run_docker.sh` or path-safe form `"/$(pwd)/decks"` to prevent Git Bash from mangling volume paths.

### Verify

```bash
ls -la logs/
# Expect: job_test1_game_1.txt, job_test1_game_2.txt
```

**Note (Windows / Git Bash):** Git Bash (MSYS) converts Unix-style paths and can append `;C` to volume paths, creating empty folders `decks;C` and `logs;C` instead of mounting `./decks` and `./logs`. Use `run_docker.sh` (sets `MSYS_NO_PATHCONV=1`) or the path-safe form `"/$(pwd)/decks"` above. Alternatively use PowerShell or WSL.

**Note (WSL / Linux):** The container runs as user `forge`. If the host `./logs` (and `./decks`) directory is not writable by others, the container may fail with "Permission denied" when writing game logs. Fix: `chmod 777 ./logs` (and `chmod 777 ./decks` if needed) before running.

## Precon Source & Manifest

Precons live in `precons/` as `.dck` files. Add or replace decks as needed.

**Manifest** (`precons/manifest.json`): Used by the Orchestrator for dropdowns and random opponent selection. Update when adding decks:

```json
{
  "id": "lorehold-legacies",
  "name": "Lorehold Legacies",
  "filename": "Lorehold Legacies.dck",
  "set": "Strixhaven Commander",
  "primaryCommander": "Osgir, the Reconstructor",
  "colors": ["R", "W"],
  "archetype": "artifacts",
  "powerLevel": 6
}
```

- **Source for lists:** [DeckCheck.co Commander Precons](https://deckcheck.co/app/precons) or similar. Export to Forge-compatible `.dck` (see PRD 3.3).

### Adding precons

To add new precons: add the `.dck` file(s) to `precons/`, then run the manifest generator to update the manifest:

```bash
python scripts/generate_manifest.py
```

(Run from `forge-simulation-engine/` or repo root.) Optionally edit `precons/manifest.json` to add `set`, `primaryCommander`, `colors`, `powerLevel`, etc. for display and Orchestrator.

## Double-faced and MDFC cards in .dck

- **Name format:** Use the standard **front and back** name with a space, two slashes, and a space: `Front // Back`.
  - Examples: `Dusk // Dawn`, `Catapult Fodder // Catapult Captain`, `Revitalizing Repast // Old-Growth Grove`.
- **Optional disambiguation:** If Forge reports "An unsupported card was requested", add the **set code and collector number** after a pipe: `CardName // OtherName|SET|collector_number`.
  - Example: `Catapult Fodder // Catapult Captain|VOW|99`, `Dusk // Dawn|CLB|1`, `Commit // Memory|NCC|1`.
- Forge looks up cards by name (and optionally by set). If a set is not in Forge’s card database yet (e.g. very new sets), that card will remain unsupported until Forge adds the set.

## CLI Reference

| Flag | Required | Description |
|------|----------|-------------|
| `--decks` | Yes | Four deck filenames in `/app/decks` (e.g. `deck_0.dck deck_1.dck deck_2.dck deck_3.dck`) |
| `--id` | Yes | Job ID for logs: `{id}_game_{n}.txt` |
| `--simulations` | No | Number of games (default: 5) |

## Orchestrator Integration

1. Build image: `docker build -t forge-sim .`
2. Run job (use named volumes; from Git Bash use `MSYS_NO_PATHCONV=1` or `run_docker.sh` if using bind mounts like `$(pwd)/decks`):
   ```bash
   docker run --rm \
     -v decks_vol:/app/decks \
     -v logs_vol:/app/logs \
     forge-sim \
     --decks deck_0.dck deck_1.dck deck_2.dck deck_3.dck \
     --simulations 5 \
     --id <job_id>
   ```
3. After exit, read logs from `logs_vol`: `{job_id}_game_1.txt`, `{job_id}_game_2.txt`, ...

## Directory Layout (in container)

| Path | Purpose |
|------|---------|
| `/app/forge.sh` | Forge launcher (extracted from release tar) |
| `/app/res/precons/` | Baked-in precon `.dck` files (for reference; orchestrator copies needed decks to /app/decks) |
| `/app/decks/` | Volume: 4 deck files from Orchestrator |
| `/app/logs/` | Volume: output `{job_id}_game_{n}.txt` |

## Log Format

Logs capture game output for the Analysis Service condenser. Content includes game-over state and per-turn actions (life changes, casts, zone changes, win condition). Filename: `{job_id}_game_{n}.txt`.
