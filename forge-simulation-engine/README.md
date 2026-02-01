# Forge Simulation Engine

Headless, Dockerized MTG simulation service using [Card-Forge](https://github.com/Card-Forge/forge) in CLI sim mode. Runs Commander games (1 user deck vs 3 opponents) and outputs detailed game logs for the [Analysis Service](../analysis-service/PRD.md).

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

**Recommended (Git Bash on Windows):** Use the wrapper script so volume paths are not mangled (avoids empty `decks;C` and `logs;C` folders):

```bash
# Create local dirs for mounts
mkdir -p ./decks ./logs

# Copy a user deck into decks/
cp test/decks/minimal.dck ./decks/

# Run simulation (use run_docker.sh on Git Bash / Windows)
chmod +x run_docker.sh
./run_docker.sh \
  --user-deck minimal.dck \
  --opponents "Lorehold Legacies" "Elven Council" "Prismari Performance" \
  --simulations 2 \
  --id job_test1
```

**Or run Docker directly** (on Linux/macOS, or Git Bash with path-safe form):

```bash
mkdir -p ./decks ./logs
cp test/decks/minimal.dck ./decks/

# Path-safe form: leading slash prevents Git Bash from appending ";C" to volume paths
docker run --rm \
  -v "/$(pwd)/decks:/app/decks" \
  -v "/$(pwd)/logs:/app/logs" \
  forge-sim \
  --user-deck minimal.dck \
  --opponents "Lorehold Legacies" "Elven Council" "Prismari Performance" \
  --simulations 2 \
  --id job_test1
```

### Verify

```bash
ls -la logs/
# Expect: job_test1_game_1.txt, job_test1_game_2.txt
```

**Note (Windows / Git Bash):** Git Bash (MSYS) converts Unix-style paths and can append `;C` to volume paths, creating empty folders `decks;C` and `logs;C` instead of mounting `./decks` and `./logs`. Use `run_docker.sh` (sets `MSYS_NO_PATHCONV=1`) or the path-safe form `"/$(pwd)/decks"` above. Alternatively use PowerShell or WSL.

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

## CLI Reference

| Flag | Required | Description |
|------|----------|-------------|
| `--user-deck` | Yes | Filename in `/app/decks` (e.g. `my_deck.dck`) |
| `--opponents` | Yes | Three precon names (e.g. `"Lorehold Legacies" "Elven Council" "Prismari Performance"`) |
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
     --user-deck <filename> \
     --opponents <name1> <name2> <name3> \
     --simulations 5 \
     --id <job_id>
   ```
3. After exit, read logs from `logs_vol`: `{job_id}_game_1.txt`, `{job_id}_game_2.txt`, ...

## Directory Layout (in container)

| Path | Purpose |
|------|---------|
| `/app/forge.sh` | Forge launcher (extracted from release tar) |
| `/app/res/precons/` | Baked-in precon `.dck` files |
| `/app/decks/` | Volume: user deck(s) from Orchestrator |
| `/app/logs/` | Volume: output `{job_id}_game_{n}.txt` |
| `/app/run/decks/` | Ephemeral merged dir (user + 3 precons) |

## Log Format

Logs capture game output for the Analysis Service condenser. Content includes game-over state and per-turn actions (life changes, casts, zone changes, win condition). Filename: `{job_id}_game_{n}.txt`.
